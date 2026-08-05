import {
  BadRequestException,
  Injectable,
  NotFoundException,
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

const SHARED_REMOVAL_CHANNELS = new Set<PrinterChannelType>([
  'LOCAL_USB_ESCPOS',
  'LOCAL_LAN_ESCPOS',
  'CLOUD_FEIE',
  'CLOUD_YILIAN',
  'CLOUD_XINYE',
  'CLOUD_GPRINTER',
]);

@Injectable()
export class PrintingPrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
    private readonly settings: PrintingSettingsService,
    private readonly lanBindings: LanTerminalBindingsService,
  ) {}

  async list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const printers = await this.prisma.printer.findMany({
      where: { merchantId, deletedAt: null },
      include: {
        boundTerminal: {
          select: { id: true, name: true, platform: true },
        },
      },
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
    if (dto.channelType === 'LOCAL_LAN_ESCPOS') {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '请从 Android 打印机与设备添加 LAN 打印机',
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
    const channelType = dto.channelType ?? existing.channelType;
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

  async archive(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    reason?: string,
  ) {
    this.flags.assertTaskCenterEnabled();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`,
      );
      const existing = await tx.printer.findFirst({
        where: { id, merchantId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
          message: '打印机不存在',
        });
      }
      const usesSharedRemoval = SHARED_REMOVAL_CHANNELS.has(
        existing.channelType,
      );
      const usesLegacyRemoval = !usesSharedRemoval;
      if (existing.deletedAt) {
        return {
          printerId: existing.id,
          archived: true,
          archivedAt: existing.deletedAt,
          status: 'OFFLINE' as const,
          ...(usesLegacyRemoval
            ? {}
            : {
                cancelledJobCount: 0,
                removedCategoryBindingCount: 0,
                clearedCheckoutDefault: false,
                clearedKitchenDefault: false,
                disabledRuleCount: 0,
              }),
        };
      }

      if (usesLegacyRemoval) {
        return this.archiveWithLegacyBehavior(
          tx,
          merchantId,
          actorStaffId,
          requestId,
          existing,
          reason,
        );
      }

      await this.assertNotPrinting(tx, merchantId, id);
      const archivedAt = new Date();
      const cancelledJobCount = await this.cancelUnstartedJobs(
        tx,
        merchantId,
        id,
        archivedAt,
      );
      const routingCleanup = await this.cleanupRoutingAndRules(tx, merchantId, id);
      await tx.merchantTerminal.updateMany({
        where: { merchantId, boundPrinterId: id },
        data: { boundPrinterId: null },
      });
      const changed = await tx.printer.updateMany({
        where: {
          id,
          merchantId,
          deletedAt: null,
        },
        data: {
          enabled: false,
          status: 'OFFLINE',
          deletedAt: archivedAt,
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '打印机状态已变化，请刷新后重试',
        });
      }
      const removalClosure = {
        cancelledJobCount,
        ...routingCleanup,
      };
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINTER_ARCHIVED',
          resourceType: 'Printer',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: {
            ...this.auditView({
              ...existing,
              enabled: false,
              status: 'OFFLINE',
            }),
            archivedAt,
            removalClosure,
          },
          reason,
          requestId,
        },
        tx,
      );
      return {
        printerId: id,
        archived: true,
        archivedAt,
        status: 'OFFLINE' as const,
        ...removalClosure,
      };
    });
  }

  private async archiveWithLegacyBehavior(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    existing: {
      id: bigint;
      name: string;
      channelType: PrinterChannelType;
      paperWidth: string;
      purpose: string;
      enabled: boolean;
      status: PrintingPrinterStatus;
    },
    reason?: string,
  ) {
    const activeJob = await tx.printJob.findFirst({
      where: {
        merchantId,
        printerId: existing.id,
        status: { in: ['PENDING', 'CLAIMED', 'PRINTING', 'RETRY_WAIT'] },
      },
      select: { id: true },
    });
    if (activeJob) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_HAS_ACTIVE_JOBS,
        message: '该打印机仍有正在处理的打印任务，暂时无法移除',
      });
    }

    const archivedAt = new Date();
    await tx.printRule.updateMany({
      where: {
        merchantId,
        printerId: existing.id,
        enabled: true,
      },
      data: { enabled: false, autoPrint: false },
    });
    await tx.merchantTerminal.updateMany({
      where: { merchantId, boundPrinterId: existing.id },
      data: { boundPrinterId: null },
    });
    const changed = await tx.printer.updateMany({
      where: {
        id: existing.id,
        merchantId,
        deletedAt: null,
      },
      data: {
        enabled: false,
        status: 'OFFLINE',
        deletedAt: archivedAt,
      },
    });
    if (changed.count !== 1) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.STATE_CONFLICT,
        message: '打印机状态已变化，请刷新后重试',
      });
    }
    await this.audit.record(
      {
        merchantId,
        actorStaffId,
        action: 'PRINTER_ARCHIVED',
        resourceType: 'Printer',
        resourceId: existing.id,
        beforeData: this.auditView(existing),
        afterData: {
          ...this.auditView({
            ...existing,
            enabled: false,
            status: 'OFFLINE',
          }),
          archivedAt,
        },
        reason,
        requestId,
      },
      tx,
    );
    return {
      printerId: existing.id,
      archived: true,
      archivedAt,
      status: 'OFFLINE' as const,
    };
  }

  private async assertNotPrinting(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    printerId: bigint,
  ) {
    const activeJobs = await tx.$queryRaw<Array<{ id: bigint; status: string }>>(
      Prisma.sql`
        SELECT id, status
        FROM print_jobs
        WHERE merchant_id = ${merchantId}
          AND printer_id = ${printerId}
          AND status IN ('PENDING', 'CLAIMED', 'PRINTING', 'RETRY_WAIT')
        FOR UPDATE
      `,
    );
    const unfinishedAttempts = await tx.$queryRaw<Array<{ id: bigint }>>(
      Prisma.sql`
        SELECT pa.id
        FROM print_attempts pa
        INNER JOIN print_jobs pj ON pj.id = pa.job_id
        WHERE pj.merchant_id = ${merchantId}
          AND pj.printer_id = ${printerId}
          AND pa.finished_at IS NULL
        FOR UPDATE
      `,
    );
    if (
      activeJobs.some((job) => job.status === 'PRINTING') ||
      unfinishedAttempts.length > 0
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_PRINTING_IN_PROGRESS,
        message: '打印机正在执行任务，请等待打印完成后再移除',
      });
    }
  }

  private async cancelUnstartedJobs(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    printerId: bigint,
    archivedAt: Date,
  ) {
    const cancelledJobs = await tx.printJob.updateMany({
      where: {
        merchantId,
        printerId,
        status: { in: ['PENDING', 'CLAIMED', 'RETRY_WAIT'] },
      },
      data: {
        status: 'CANCELLED',
        completedAt: archivedAt,
        cancelledAt: archivedAt,
        claimedAt: null,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        retryBlocked: false,
        lastErrorCode: 'PRINTER_ARCHIVED',
        lastErrorMessage: '打印机已移除，任务已自动取消',
        leaseVersion: { increment: 1 },
      },
    });
    return cancelledJobs.count;
  }

  private async cleanupRoutingAndRules(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    printerId: bigint,
  ) {
    const removedCategoryBindings = await tx.printerCategoryBinding.deleteMany({
      where: { merchantId, printerId },
    });
    const routing = await tx.merchantPrintingRouting.findUnique({
      where: { merchantId },
      select: {
        checkoutDefaultPrinterId: true,
        defaultKitchenPrinterId: true,
      },
    });
    const clearedCheckoutDefault = routing?.checkoutDefaultPrinterId === printerId;
    const clearedKitchenDefault = routing?.defaultKitchenPrinterId === printerId;
    if (routing && (clearedCheckoutDefault || clearedKitchenDefault)) {
      await tx.merchantPrintingRouting.update({
        where: { merchantId },
        data: {
          checkoutDefaultPrinterId: clearedCheckoutDefault ? null : undefined,
          defaultKitchenPrinterId: clearedKitchenDefault ? null : undefined,
        },
      });
    }
    const disabledRules = await tx.printRule.updateMany({
      where: {
        merchantId,
        printerId,
        OR: [{ enabled: true }, { autoPrint: true }],
      },
      data: { enabled: false, autoPrint: false },
    });
    return {
      removedCategoryBindingCount: removedCategoryBindings.count,
      clearedCheckoutDefault,
      clearedKitchenDefault,
      disabledRuleCount: disabledRules.count,
    };
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
      ...(printer.channelType === 'LOCAL_LAN_ESCPOS'
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
