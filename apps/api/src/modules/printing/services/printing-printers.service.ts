import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrinterChannelType, PrintingPrinterStatus, Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreatePrintingPrinterDto,
  UpdatePrintingPrinterDto,
} from '../dto/printer.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import {
  IMPLEMENTED_PRINTING_CHANNELS,
  printerReadiness,
} from '../utils/printer-readiness';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';
import { LanTerminalBindingsService } from './lan-terminal-bindings.service';
import { V2TerminalBindingsService } from './v2-terminal-bindings.service';
import { v2BindingMetadata } from '../types/v2-terminal-binding';

@Injectable()
export class PrintingPrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
    private readonly settings: PrintingSettingsService,
    private readonly lanBindings: LanTerminalBindingsService,
    @Optional()
    private readonly v2Bindings?: V2TerminalBindingsService,
  ) {}

  async list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const printers = await this.prisma.printer.findMany({
      where: { merchantId, deletedAt: null },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    return Promise.all(printers.map((printer) => this.serialize(printer)));
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
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    this.assertNoV2ReservedCapabilities(dto.capabilities);
    if (
      dto.channelType === 'LOCAL_LAN_ESCPOS' ||
      dto.channelType === 'LOCAL_BLUETOOTH_ESCPOS'
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '请从 Android 打印机与设备添加本地打印机',
      });
    }
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
          enabled:
            dto.channelType === 'LOCAL_LAN_ESCPOS' ? false : dto.enabled ?? false,
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
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const existing = await this.requireOwned(merchantId, id);
    this.assertNoV2ReservedCapabilities(dto.capabilities);
    const v2Managed = Boolean(v2BindingMetadata(existing.capabilities));
    const channelType = dto.channelType ?? existing.channelType;
    if (
      dto.channelType === 'LOCAL_BLUETOOTH_ESCPOS' &&
      existing.channelType !== 'LOCAL_BLUETOOTH_ESCPOS'
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '请从 Android 打印机与设备添加经典蓝牙打印机',
      });
    }
    if (
      v2Managed &&
      (dto.channelType !== undefined ||
        dto.connectionConfig !== undefined ||
        dto.capabilities !== undefined ||
        dto.paperWidth !== undefined ||
        dto.enabled === true)
    ) {
      throw new BadRequestException({
        code:
          dto.enabled === true
            ? PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED
            : PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          dto.enabled === true
            ? 'V2 本地打印机必须通过专用启用接口并完成测试打印'
            : 'V2 本地连接、纸宽与 Binding 只能在对应 Android 终端中修改',
      });
    }
    if (
      dto.channelType === 'LOCAL_LAN_ESCPOS' &&
      existing.channelType !== 'LOCAL_LAN_ESCPOS'
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '请从 Android 打印机与设备添加 LAN 打印机',
      });
    }
    if (
      existing.channelType === 'LOCAL_LAN_ESCPOS' &&
      dto.channelType !== undefined &&
      dto.channelType !== 'LOCAL_LAN_ESCPOS'
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'Android 同步的 LAN 打印机不能在后台切换通道',
      });
    }
    if (
      existing.channelType === 'LOCAL_LAN_ESCPOS' &&
      dto.enabled === true
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED,
        message: 'LAN 打印机必须通过专用启用接口并完成后台测试打印',
      });
    }
    if (
      existing.channelType === 'LOCAL_LAN_ESCPOS' &&
      (dto.connectionConfig !== undefined ||
        dto.capabilities !== undefined ||
        dto.paperWidth !== undefined)
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          'LAN 连接、纸宽与 Binding 只能在对应 Android 商家终端中修改',
      });
    }
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
    await this.settings.assertMerchantPrintingEnabled(merchantId);
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

  async enable(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const owned = this.v2Bindings
      ? await this.requireOwned(merchantId, id)
      : null;
    if (owned && v2BindingMetadata(owned.capabilities) && this.v2Bindings) {
      const { printer: existing } = await this.v2Bindings.requireEnableable(
        merchantId,
        id,
      );
      if (existing.enabled) return this.serialize(existing);
      const updated = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.printer.updateMany({
          where: {
            id,
            merchantId,
            channelType: existing.channelType,
            enabled: false,
            updatedAt: existing.updatedAt,
            deletedAt: null,
          },
          data: { enabled: true },
        });
        if (changed.count !== 1) {
          throw new BadRequestException({
            code: PRINTING_ERROR_CODES.STATE_CONFLICT,
            message: '打印机状态已变化，请刷新后重试',
          });
        }
        const printer = await tx.printer.findUniqueOrThrow({ where: { id } });
        await this.audit.record(
          {
            merchantId,
            actorStaffId,
            action: 'V2_LOCAL_PRINTER_ENABLED',
            resourceType: 'Printer',
            resourceId: id,
            beforeData: this.auditView(existing),
            afterData: this.auditView(printer),
            requestId,
          },
          tx,
        );
        return printer;
      });
      return this.serialize(updated);
    }
    const { printer: existing } = await this.lanBindings.requireEnableable(
      merchantId,
      id,
    );
    if (existing.enabled) return this.serialize(existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.printer.updateMany({
        where: {
          id,
          merchantId,
          channelType: 'LOCAL_LAN_ESCPOS',
          enabled: false,
          updatedAt: existing.updatedAt,
          deletedAt: null,
        },
        data: { enabled: true },
      });
      if (changed.count !== 1) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '打印机状态已变化，请刷新后重试',
        });
      }
      const printer = await tx.printer.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'LAN_PRINTER_ENABLED',
          resourceType: 'Printer',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(printer),
          requestId,
        },
        tx,
      );
      return printer;
    });
    return this.serialize(updated);
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
    if (channelType === 'CLOUD_FEIE' || channelType === 'CLOUD_YILIAN') {
      const requiredKey = channelType === 'CLOUD_FEIE' ? 'printerSn' : 'machineCode';
      if (Object.keys(value).some((key) => key !== requiredKey) || (value[requiredKey] !== undefined && (typeof value[requiredKey] !== 'string' || !String(value[requiredKey]).trim()))) {
        this.configError(`${requiredKey} 是必填的设备标识`);
      }
      return value[requiredKey] === undefined ? {} as Prisma.InputJsonObject : { [requiredKey]: String(value[requiredKey]).trim() } satisfies Prisma.InputJsonObject;
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
    const port = value.port ?? 9100;
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

  private assertNoV2ReservedCapabilities(value: Record<string, unknown> | undefined) {
    if (value && ('v2Binding' in value || 'v2Status' in value)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'v2Binding 与 v2Status 只能由 V2 终端接口维护',
      });
    }
  }

  private async serialize<
    T extends {
      channelType: PrinterChannelType;
      enabled: boolean;
      status: PrintingPrinterStatus;
      connectionConfig: Prisma.JsonValue;
      capabilities: Prisma.JsonValue;
    },
  >(printer: T) {
    const channelImplemented = IMPLEMENTED_PRINTING_CHANNELS.has(
      printer.channelType,
    );
    const readiness = printerReadiness(printer);
    return {
      ...printer,
      readiness,
      adapterStatus: channelImplemented
        ? !this.flags.executionEnabled()
          ? PRINTING_ERROR_CODES.EXECUTION_DISABLED
          : readiness.state === 'READY'
            ? 'READY'
            : readiness.state
        : PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
      executionState:
        this.flags.executionEnabled() && readiness.state === 'READY'
          ? 'READY'
          : 'CONNECTOR_PENDING',
      ...(v2BindingMetadata(printer.capabilities) && this.v2Bindings
        ? { v2: await this.v2Bindings.describe(printer as unknown as import('@prisma/client').Printer) }
        : printer.channelType === 'LOCAL_LAN_ESCPOS'
        ? { lan: await this.lanBindings.describe(printer as unknown as import('@prisma/client').Printer) }
        : {}),
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
