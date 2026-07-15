import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreatePrintingPrinterDto,
  UpdatePrintingPrinterDto,
} from '../dto/printer.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

@Injectable()
export class PrintingPrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const printers = await this.prisma.printer.findMany({
      where: { merchantId, deletedAt: null },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    return printers.map((printer) => this.serialize(printer));
  }

  async get(merchantId: bigint, id: bigint) {
    this.flags.assertTaskCenterEnabled();
    return this.serialize(await this.requireOwned(merchantId, id));
  }

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreatePrintingPrinterDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const connectionConfig = this.normalizeConnectionConfig(
      dto.channelType,
      dto.connectionConfig,
    );
    const capabilities = this.normalizeSafeJson(dto.capabilities ?? {});
    const printer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.printer.create({
        data: {
          merchantId,
          name: dto.name,
          channelType: dto.channelType,
          paperWidth: dto.paperWidth,
          purpose: dto.purpose ?? 'FRONT_DESK',
          enabled: dto.enabled ?? false,
          status: 'UNVERIFIED',
          connectionConfig,
          capabilities,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINTER_CREATED',
          resourceType: 'Printer',
          resourceId: created.id,
          afterData: this.auditView(created),
          requestId,
        },
        tx,
      );
      return created;
    });
    return this.serialize(printer);
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    dto: UpdatePrintingPrinterDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    const channelType = dto.channelType ?? existing.channelType;
    if (
      dto.channelType !== undefined &&
      dto.channelType !== existing.channelType &&
      dto.connectionConfig === undefined
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '修改通道类型时必须同时提交与新通道匹配的连接配置',
      });
    }
    const connectionConfig = dto.connectionConfig
      ? this.normalizeConnectionConfig(channelType, dto.connectionConfig)
      : undefined;
    const capabilities = dto.capabilities
      ? this.normalizeSafeJson(dto.capabilities)
      : undefined;
    const printer = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.printer.update({
        where: { id },
        data: {
          name: dto.name,
          channelType: dto.channelType,
          paperWidth: dto.paperWidth,
          purpose: dto.purpose,
          enabled: dto.enabled,
          connectionConfig,
          capabilities,
          status:
            dto.channelType !== undefined || dto.connectionConfig !== undefined
              ? 'UNVERIFIED'
              : undefined,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINTER_UPDATED',
          resourceType: 'Printer',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(printer);
  }

  async disable(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    const printer = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.printer.update({
        where: { id },
        data: { enabled: false },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINTER_DISABLED',
          resourceType: 'Printer',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(printer);
  }

  async requireOwned(merchantId: bigint, id: bigint) {
    const printer = await this.prisma.printer.findFirst({
      where: { id, merchantId, deletedAt: null },
    });
    if (!printer) {
      throw new NotFoundException({
        code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: '打印机不存在',
      });
    }
    return printer;
  }

  private normalizeConnectionConfig(channelType: string, value: Record<string, unknown>) {
    this.assertNoSecrets(value);
    if (channelType === 'LOCAL_USB_ESCPOS') {
      const allowed = ['paperWidthDots', 'threshold', 'cutMode'];
      if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: 'USB 配置仅允许纸张点宽、阈值和切纸方式',
        });
      }
      const paperWidthDots = value.paperWidthDots;
      const threshold = value.threshold;
      const cutMode = value.cutMode;
      if (
        paperWidthDots !== undefined &&
        (!Number.isInteger(paperWidthDots) ||
          Number(paperWidthDots) < 200 ||
          Number(paperWidthDots) > 1024)
      ) {
        this.configError('USB paperWidthDots 必须是 200–1024 的整数');
      }
      if (
        threshold !== undefined &&
        (!Number.isInteger(threshold) ||
          Number(threshold) < 0 ||
          Number(threshold) > 255)
      ) {
        this.configError('USB threshold 必须是 0–255 的整数');
      }
      if (
        cutMode !== undefined &&
        !['NONE', 'HALF', 'FULL'].includes(String(cutMode))
      ) {
        this.configError('USB cutMode 仅允许 NONE、HALF 或 FULL');
      }
      return {
        ...(paperWidthDots === undefined
          ? {}
          : { paperWidthDots: Number(paperWidthDots) }),
        ...(threshold === undefined ? {} : { threshold: Number(threshold) }),
        ...(cutMode === undefined ? {} : { cutMode: String(cutMode) }),
      } satisfies Prisma.InputJsonObject;
    }
    if (channelType !== 'LOCAL_LAN_ESCPOS') {
      if (Object.keys(value).length > 0) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
          message: '该打印通道本阶段仅可创建空配置，尚未接入适配器',
        });
      }
      return {} as Prisma.InputJsonObject;
    }
    const keys = Object.keys(value);
    if (keys.some((key) => !['host', 'port'].includes(key))) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'LAN 配置仅允许 host 和 port',
      });
    }
    const host = value.host;
    const port = value.port;
    if (typeof host !== 'string' || !isPrivateIpv4(host)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'LAN host 必须是 RFC1918 私有 IPv4 地址',
      });
    }
    if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'LAN port 必须是 1–65535 的整数',
      });
    }
    return { host, port: Number(port) } satisfies Prisma.InputJsonObject;
  }

  private normalizeSafeJson(value: Record<string, unknown>) {
    this.assertNoSecrets(value);
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > 8_192) {
        throw new Error('capabilities exceeds 8192 bytes');
      }
      return JSON.parse(serialized) as Prisma.InputJsonObject;
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          error instanceof Error && error.message.includes('8192')
            ? '打印机能力信息过大'
            : '打印机能力信息必须是有效 JSON',
      });
    }
  }

  private assertNoSecrets(value: unknown, path = 'config') {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: `${path} 不允许保存密钥字段`,
        });
      }
      this.assertNoSecrets(nested, `${path}.${key}`);
    }
  }

  private serialize<T extends { channelType: string }>(printer: T) {
    const usb = printer.channelType === 'LOCAL_USB_ESCPOS';
    return {
      ...printer,
      adapterStatus: usb
        ? this.flags.executionEnabled()
          ? 'READY_FOR_TERMINAL_BINDING'
          : PRINTING_ERROR_CODES.EXECUTION_DISABLED
        : PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
      executionState: this.flags.executionEnabled()
        ? 'CONNECTOR_NOT_REGISTERED'
        : 'CONNECTOR_PENDING',
    };
  }

  private configError(message: string): never {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message,
    });
  }

  private auditView(printer: {
    id: bigint;
    name: string;
    channelType: string;
    paperWidth: string;
    purpose: string;
    enabled: boolean;
    status: string;
  }) {
    return {
      id: printer.id.toString(),
      name: printer.name,
      channelType: printer.channelType,
      paperWidth: printer.paperWidth,
      purpose: printer.purpose,
      enabled: printer.enabled,
      status: printer.status,
    };
  }
}

function isPrivateIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const octets = value.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
