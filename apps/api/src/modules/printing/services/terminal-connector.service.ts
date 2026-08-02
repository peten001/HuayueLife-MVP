import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ReportTerminalPrinterStatusDto,
  SyncUsbTerminalBindingDto,
  TerminalHeartbeatDto,
} from '../dto/terminal-connector.dto';
import {
  containsPrintingCredentialMaterial,
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';
import { hasExplicitUsbExecutionEvidence } from '../utils/printer-readiness';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

const ANDROID_USB_ESCPOS_ADAPTER = 'ANDROID_USB_ESCPOS';

@Injectable()
export class TerminalConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async heartbeat(terminal: AuthenticatedTerminal, dto: TerminalHeartbeatDto) {
    this.flags.assertTaskCenterEnabled();
    const now = new Date();
    const current = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        revokedAt: null,
      },
      select: { capabilities: true, configVersion: true },
    });
    if (!current) this.disabled();
    const currentCapabilities = isPlainObject(current.capabilities)
      ? current.capabilities
      : {};
    const capabilities = normalizeSafeJson({
      ...currentCapabilities,
      ...(dto.capabilities ? { connector: dto.capabilities } : {}),
      ...(dto.diagnostics
        ? {
            diagnostics: {
              ...dto.diagnostics,
              heartbeatSeq: dto.heartbeatSeq,
              buildRevision: dto.buildRevision,
              activeJobIds: dto.activeJobIds,
              reportedAt: now.toISOString(),
            },
          }
        : {}),
    });
    const updated = await this.prisma.merchantTerminal.updateMany({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        revokedAt: null,
        tokenVersion: terminal.tokenVersion,
      },
      data: {
        appVersion: dto.appVersion,
        capabilities,
        lastSeenAt: now,
        lastErrorCode: dto.lastErrorCode?.slice(0, 64) ?? null,
        lastErrorMessage: sanitizePrintingError(dto.lastErrorMessage),
        resetUsbAcknowledgedAt:
          dto.appliedConfigVersion !== undefined &&
          dto.appliedConfigVersion >= current.configVersion
            ? now
            : undefined,
      },
    });
    if (updated.count !== 1) this.disabled();
    return {
      terminalId: terminal.id,
      serverTime: now,
      nextHeartbeatSeconds: this.heartbeatIntervalSeconds(),
      pollIntervalSeconds: this.pollIntervalSeconds(),
      configVersion: current.configVersion,
    };
  }

  async configFor(terminal: AuthenticatedTerminal) {
    this.flags.assertTaskCenterEnabled();
    const record = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        appVersion: true,
        boundPrinterId: true,
        configVersion: true,
        resetUsbRequestedAt: true,
        resetUsbAcknowledgedAt: true,
        merchant: { select: { id: true, printingEnabled: true } },
        boundPrinter: {
          select: {
            id: true,
            name: true,
            channelType: true,
            paperWidth: true,
            purpose: true,
            enabled: true,
            status: true,
            connectionConfig: true,
            capabilities: true,
          },
        },
      },
    });
    if (!record) this.disabled();
    return {
      terminal: {
        id: record.id,
        name: record.name,
        status: record.status,
        appVersion: record.appVersion,
        boundPrinterId: record.boundPrinterId,
        configVersion: record.configVersion,
      },
      taskCenterEnabled: this.flags.taskCenterEnabled(),
      executionEnabled: this.flags.executionEnabled(),
      automaticCreationEnabled: this.flags.automaticCreationEnabled(),
      legacyPrintingEnabled: this.flags.legacyPrintingEnabled(),
      terminalEnabled: record.status === 'ACTIVE',
      merchantPrintingEnabled: record.merchant.printingEnabled,
      printerEnabled: record.boundPrinter?.enabled ?? false,
      pollIntervalSeconds: this.pollIntervalSeconds(),
      heartbeatIntervalSeconds: this.heartbeatIntervalSeconds(),
      boundPrinter: record.boundPrinter,
      commands: {
        resetUsb:
          record.resetUsbRequestedAt &&
          (!record.resetUsbAcknowledgedAt ||
            record.resetUsbAcknowledgedAt < record.resetUsbRequestedAt)
            ? {
                configVersion: record.configVersion,
                requestedAt: record.resetUsbRequestedAt,
              }
            : null,
      },
    };
  }

  async lanConfigFor(terminal: AuthenticatedTerminal) {
    const record = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        revokedAt: null,
        tokenVersion: terminal.tokenVersion,
      },
      select: {
        status: true,
        merchant: { select: { status: true, printingEnabled: true } },
      },
    });
    if (!record) this.disabled();
    return {
      taskCenterEnabled: this.flags.taskCenterEnabled(),
      executionEnabled: this.flags.executionEnabled(),
      lanPrintingEnabled: this.flags.lanPrintingEnabled(),
      automaticCreationEnabled: this.flags.automaticCreationEnabled(),
      merchantPrintingEnabled:
        record.merchant.status === 'ACTIVE' && record.merchant.printingEnabled,
      terminalEnabled: record.status === 'ACTIVE',
      terminalStatus: record.status,
      pollIntervalSeconds: this.pollIntervalSeconds(),
    };
  }

  async syncUsbBinding(
    terminal: AuthenticatedTerminal,
    requestId: string | undefined,
    dto: SyncUsbTerminalBindingDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    if (terminal.status !== 'ACTIVE') this.disabled();
    const reportedCapabilities = dto.capabilities
      ? normalizeSafeJson(dto.capabilities)
      : {};
    const reportedStatus = dto.status ?? 'UNKNOWN';

    return this.prisma.$transaction(async (tx) => {
      // localBindingId lives in JSON rather than a unique column. Serializing on
      // the merchant row keeps retries and two terminals from creating duplicates.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM merchants WHERE id = ${terminal.merchantId} FOR UPDATE`,
      );
      const activeTerminal = await tx.merchantTerminal.findFirst({
        where: {
          id: terminal.id,
          merchantId: terminal.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: terminal.tokenVersion,
        },
        select: {
          id: true,
          boundPrinterId: true,
          deviceIdentifier: true,
          merchant: { select: { status: true, printingEnabled: true } },
        },
      });
      if (!activeTerminal?.deviceIdentifier) this.disabled();
      if (
        activeTerminal.merchant.status !== 'ACTIVE' ||
        !activeTerminal.merchant.printingEnabled
      ) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
          message: '当前商家未启用打印能力',
        });
      }

      const printers = await tx.printer.findMany({
        where: {
          merchantId: terminal.merchantId,
          channelType: 'LOCAL_USB_ESCPOS',
        },
        orderBy: { id: 'asc' },
      });
      const archivedExactBinding = printers.find((printer) => {
        const binding = usbBindingMetadata(printer.capabilities);
        return Boolean(
          printer.deletedAt && binding?.localBindingId === dto.localBindingId,
        );
      });
      if (archivedExactBinding) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.PRINTER_ARCHIVED_READD_REQUIRED,
          message: '该 USB Binding 已在后台移除，请生成新的本地 Binding 后重新添加',
        });
      }

      const activePrinters = printers.filter((printer) => !printer.deletedAt);
      const exactBinding = activePrinters.find((printer) => {
        const binding = usbBindingMetadata(printer.capabilities);
        return (
          binding?.terminalId === terminal.id.toString() &&
          binding.localBindingId === dto.localBindingId
        );
      });
      const crossTerminalBinding = activePrinters.find((printer) => {
        const binding = usbBindingMetadata(printer.capabilities);
        return (
          binding?.localBindingId === dto.localBindingId &&
          binding.terminalId !== terminal.id.toString()
        );
      });
      if (crossTerminalBinding) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '该 USB Binding 已绑定另一终端',
        });
      }

      const currentlyBound = activeTerminal.boundPrinterId
        ? activePrinters.find(
            (printer) => printer.id === activeTerminal.boundPrinterId,
          )
        : undefined;
      if (activeTerminal.boundPrinterId && !currentlyBound) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '终端当前绑定的 USB 打印机不可用，请先人工核对平台记录',
        });
      }
      if (exactBinding && currentlyBound && exactBinding.id !== currentlyBound.id) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '终端 USB Binding 与当前平台绑定不一致',
        });
      }

      const currentBinding = currentlyBound
        ? usbBindingMetadata(currentlyBound.capabilities)
        : null;
      if (
        currentBinding &&
        (currentBinding.terminalId !== terminal.id.toString() ||
          currentBinding.localBindingId !== dto.localBindingId)
      ) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: '该终端已绑定另一 USB 本地设备',
        });
      }

      const existing = exactBinding ?? currentlyBound;
      const previousBinding = existing
        ? usbBindingMetadata(existing.capabilities)
        : null;
      if (
        previousBinding &&
        (previousBinding.vendorId !== dto.vendorId ||
          previousBinding.productId !== dto.productId ||
          existing?.paperWidth !== dto.paperWidth)
      ) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: 'USB 物理身份或纸宽已变化，请生成新的本地 Binding 后重新添加',
        });
      }

      if (existing) {
        const occupied = await tx.merchantTerminal.findFirst({
          where: {
            merchantId: terminal.merchantId,
            boundPrinterId: existing.id,
            id: { not: terminal.id },
            revokedAt: null,
          },
          select: { id: true },
        });
        if (occupied) {
          throw new ConflictException({
            code: PRINTING_ERROR_CODES.STATE_CONFLICT,
            message: '该 USB 打印机已绑定另一终端',
          });
        }
      }

      const now = new Date();
      const bindingVersion = previousBinding?.bindingVersion ?? 1;
      const persistedStatus = usbPersistedStatus(
        reportedStatus,
        reportedCapabilities,
      );
      const bindingUpdatedAt =
        previousBinding?.bindingUpdatedAt ?? now.toISOString();
      const currentCapabilities =
        existing && isPlainObject(existing.capabilities)
          ? existing.capabilities
          : {};
      const capabilities = normalizeSafeJson({
        ...currentCapabilities,
        usbBinding: {
          terminalId: terminal.id.toString(),
          localBindingId: dto.localBindingId,
          terminalInstanceId: activeTerminal.deviceIdentifier,
          executor: 'TERMINAL',
          adapter: ANDROID_USB_ESCPOS_ADAPTER,
          bindingVersion,
          bindingUpdatedAt,
          vendorId: dto.vendorId,
          productId: dto.productId,
        },
        connectorStatus: {
          ...reportedCapabilities,
          connectionType: 'USB',
          status: reportedStatus,
          localBindingId: dto.localBindingId,
        },
        connectorStatusUpdatedAt: now.toISOString(),
        ...(persistedStatus === 'ONLINE'
          ? { lastConnectedAt: now.toISOString() }
          : {}),
      });
      const printer = existing
        ? await tx.printer.update({
            where: { id: existing.id },
            data: {
              name: dto.name,
              paperWidth: dto.paperWidth,
              enabled: dto.enabled,
              capabilities,
              status: persistedStatus,
            },
          })
        : await tx.printer.create({
            data: {
              merchantId: terminal.merchantId,
              name: dto.name,
              channelType: 'LOCAL_USB_ESCPOS',
              paperWidth: dto.paperWidth,
              purpose: 'FRONT_DESK',
              enabled: dto.enabled,
              status: persistedStatus,
              connectionConfig: {},
              capabilities,
            },
          });
      const terminalUpdated = await tx.merchantTerminal.updateMany({
        where: {
          id: terminal.id,
          merchantId: terminal.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: terminal.tokenVersion,
          boundPrinterId: activeTerminal.boundPrinterId,
        },
        data: {
          boundPrinterId: printer.id,
          appVersion: dto.appVersion,
          lastSeenAt: now,
        },
      });
      if (terminalUpdated.count !== 1) this.disabled();
      await this.audit.record(
        {
          merchantId: terminal.merchantId,
          action: existing ? 'USB_BINDING_SYNCED' : 'USB_BINDING_CREATED',
          resourceType: 'Printer',
          resourceId: printer.id,
          afterData: {
            terminalId: terminal.id.toString(),
            localBindingId: dto.localBindingId,
            bindingVersion,
            enabled: printer.enabled,
          },
          requestId,
        },
        tx,
      );
      return {
        merchantId: terminal.merchantId,
        terminalId: terminal.id,
        printerId: printer.id,
        localBindingId: dto.localBindingId,
        bindingVersion,
        channelType: 'LOCAL_USB_ESCPOS' as const,
        status: printer.status,
        enabled: printer.enabled,
        reportedAt: now,
      };
    });
  }

  async reportPrinterStatus(
    terminal: AuthenticatedTerminal,
    dto: ReportTerminalPrinterStatusDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    if (terminal.status !== 'ACTIVE') this.disabled();
    const printerId = BigInt(dto.printerId);
    const reportedCapabilities = dto.capabilities
      ? normalizeSafeJson(dto.capabilities)
      : {};
    const persistedStatus = usbPersistedStatus(
      dto.status,
      reportedCapabilities,
    );
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const activeTerminal = await tx.merchantTerminal.findFirst({
        where: {
          id: terminal.id,
          merchantId: terminal.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: terminal.tokenVersion,
        },
        select: { id: true, boundPrinterId: true },
      });
      if (!activeTerminal) this.disabled();
      if (activeTerminal.boundPrinterId !== printerId) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
          message: '终端只能上报当前绑定的打印机状态',
        });
      }
      const printer = await tx.printer.findFirst({
        where: {
          id: printerId,
          merchantId: terminal.merchantId,
          channelType: 'LOCAL_USB_ESCPOS',
          deletedAt: null,
        },
        select: { capabilities: true },
      });
      if (!printer) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
          message: '绑定的 USB 打印机不存在',
        });
      }
      const currentCapabilities = isPlainObject(printer.capabilities)
        ? printer.capabilities
        : {};
      const changed = await tx.printer.updateMany({
        where: {
          id: printerId,
          merchantId: terminal.merchantId,
          channelType: 'LOCAL_USB_ESCPOS',
          deletedAt: null,
        },
        data: {
          status: persistedStatus,
          capabilities: normalizeSafeJson({
            ...currentCapabilities,
            connectorStatus: {
              ...reportedCapabilities,
              connectionType: 'USB',
              status: dto.status,
            },
            connectorStatusUpdatedAt: now.toISOString(),
            ...(persistedStatus === 'ONLINE'
              ? { lastConnectedAt: now.toISOString() }
              : {}),
          }),
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
          message: '绑定的 USB 打印机不存在',
        });
      }
      await tx.merchantTerminal.update({
        where: { id: terminal.id },
        data: {
          lastSeenAt: now,
          lastErrorCode: dto.lastErrorCode?.slice(0, 64) ?? null,
          lastErrorMessage: sanitizePrintingError(dto.lastErrorMessage),
        },
      });
      return {
        printerId,
        reportedStatus: dto.status,
        persistedStatus,
        reportedAt: now,
      };
    });
  }

  private pollIntervalSeconds() {
    return boundedInteger(this.config.get('TERMINAL_JOB_POLL_SECONDS'), 5, 10, 5);
  }

  private heartbeatIntervalSeconds() {
    return boundedInteger(
      this.config.get('TERMINAL_HEARTBEAT_SECONDS'),
      10,
      60,
      20,
    );
  }

  private disabled(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
      message: '终端已停用、撤销或凭据已轮换',
    });
  }
}

function normalizeSafeJson(value: Record<string, unknown>) {
  assertNoSecrets(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 16_384) throw new Error('too large');
    return JSON.parse(serialized) as Prisma.InputJsonObject;
  } catch {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '终端诊断信息必须是小于 16KB 的有效 JSON',
    });
  }
}

type UsbBindingMetadata = {
  terminalId: string;
  localBindingId: string;
  terminalInstanceId: string;
  executor: 'TERMINAL';
  adapter: typeof ANDROID_USB_ESCPOS_ADAPTER;
  bindingVersion: number;
  bindingUpdatedAt: string;
  vendorId: number;
  productId: number;
};

function usbBindingMetadata(value: Prisma.JsonValue): UsbBindingMetadata | null {
  if (!isPlainObject(value) || !isPlainObject(value.usbBinding)) return null;
  const binding = value.usbBinding;
  if (
    typeof binding.terminalId !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(binding.terminalId) ||
    typeof binding.localBindingId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(binding.localBindingId) ||
    typeof binding.terminalInstanceId !== 'string' ||
    binding.terminalInstanceId.length < 1 ||
    binding.terminalInstanceId.length > 128 ||
    binding.executor !== 'TERMINAL' ||
    binding.adapter !== ANDROID_USB_ESCPOS_ADAPTER ||
    !Number.isInteger(binding.bindingVersion) ||
    Number(binding.bindingVersion) < 1 ||
    Number(binding.bindingVersion) > 2_147_483_647 ||
    typeof binding.bindingUpdatedAt !== 'string' ||
    Number.isNaN(new Date(binding.bindingUpdatedAt).getTime()) ||
    !validUsbId(binding.vendorId) ||
    !validUsbId(binding.productId)
  ) {
    return null;
  }
  return {
    terminalId: binding.terminalId,
    localBindingId: binding.localBindingId,
    terminalInstanceId: binding.terminalInstanceId,
    executor: 'TERMINAL',
    adapter: ANDROID_USB_ESCPOS_ADAPTER,
    bindingVersion: Number(binding.bindingVersion),
    bindingUpdatedAt: binding.bindingUpdatedAt,
    vendorId: Number(binding.vendorId),
    productId: Number(binding.productId),
  };
}

function validUsbId(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 65_535;
}

function usbPersistedStatus(
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
  capabilities: Record<string, unknown>,
) {
  if (status === 'CONNECTED') {
    return hasExplicitUsbExecutionEvidence(capabilities) ? 'ONLINE' : 'UNKNOWN';
  }
  if (status === 'DISCONNECTED') return 'OFFLINE';
  return status;
}

function assertNoSecrets(value: unknown) {
  if (
    typeof value === 'string' &&
    containsPrintingCredentialMaterial(value)
  ) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '终端诊断信息不允许包含敏感字段',
    });
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端诊断信息不允许包含敏感字段',
      });
    }
    assertNoSecrets(nested);
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
