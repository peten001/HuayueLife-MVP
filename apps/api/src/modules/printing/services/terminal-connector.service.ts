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
  TerminalHeartbeatDto,
} from '../dto/terminal-connector.dto';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

@Injectable()
export class TerminalConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: PrintingFeatureFlagsService,
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

  async reportPrinterStatus(
    terminal: AuthenticatedTerminal,
    dto: ReportTerminalPrinterStatusDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    if (terminal.status !== 'ACTIVE') this.disabled();
    const printerId = BigInt(dto.printerId);
    const capabilities = dto.capabilities
      ? normalizeSafeJson(dto.capabilities)
      : undefined;
    const persistedStatus =
      dto.status === 'CONNECTED'
        ? 'UNKNOWN'
        : dto.status === 'DISCONNECTED'
          ? 'OFFLINE'
          : dto.status;
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
            ...(capabilities ?? {}),
            connectorState: dto.status,
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

function assertNoSecrets(value: unknown) {
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
