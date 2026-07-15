import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateMerchantTerminalDto,
  UpdateMerchantTerminalDto,
} from '../dto/terminal.dto';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { quarantineTerminalJobs } from './terminal-credentials.service';

@Injectable()
export class TerminalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
    private readonly config: ConfigService,
  ) {}

  async list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const terminals = await this.prisma.merchantTerminal.findMany({
      where: { merchantId },
      include: {
        boundPrinter: {
          select: {
            id: true,
            name: true,
            channelType: true,
            paperWidth: true,
            enabled: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return terminals.map((terminal) => this.serialize(terminal));
  }

  async get(merchantId: bigint, id: bigint) {
    this.flags.assertTaskCenterEnabled();
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id, merchantId },
      include: {
        boundPrinter: {
          select: {
            id: true,
            name: true,
            channelType: true,
            paperWidth: true,
            enabled: true,
            status: true,
            capabilities: true,
          },
        },
        attempts: {
          orderBy: { startedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            jobId: true,
            attemptNo: true,
            startedAt: true,
            finishedAt: true,
            result: true,
            errorCode: true,
            errorMessage: true,
            bytesWritten: true,
          },
        },
      },
    });
    if (!terminal) this.notFound();
    return this.serialize(terminal);
  }

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreateMerchantTerminalDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const capabilities = this.normalizeCapabilities(dto.capabilities ?? {});
    const boundPrinterId = dto.boundPrinterId
      ? BigInt(dto.boundPrinterId)
      : undefined;
    if (boundPrinterId) {
      await this.validateBoundPrinter(merchantId, boundPrinterId);
    }
    try {
      const terminal = await this.prisma.$transaction(async (tx) => {
        const created = await tx.merchantTerminal.create({
          data: {
            merchantId,
            ...(boundPrinterId ? { boundPrinterId } : {}),
            name: dto.name,
            platform: dto.platform,
            status: 'UNPAIRED',
            capabilities,
          },
        });
        await this.audit.record(
          {
            merchantId,
            actorStaffId,
            action: 'TERMINAL_CREATED',
            resourceType: 'MerchantTerminal',
            resourceId: created.id,
            afterData: this.auditView(created),
            requestId,
          },
          tx,
        );
        return created;
      });
      return this.serialize(terminal);
    } catch (error) {
      if (isUniqueViolation(error)) this.bindingConflict();
      throw error;
    }
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    dto: UpdateMerchantTerminalDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.STATE_CONFLICT,
        message: '已撤销终端不能继续修改',
      });
    }
    const capabilities = dto.capabilities
      ? this.normalizeCapabilities(dto.capabilities)
      : undefined;
    const boundPrinterId =
      dto.boundPrinterId === null
        ? null
        : dto.boundPrinterId
          ? BigInt(dto.boundPrinterId)
          : undefined;
    if (typeof boundPrinterId === 'bigint') {
      await this.validateBoundPrinter(merchantId, boundPrinterId, id);
    }
    try {
      const terminal = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.merchantTerminal.updateMany({
          where: {
            id,
            merchantId,
            status: existing.status,
            tokenVersion: existing.tokenVersion,
            revokedAt: null,
          },
          data: {
            name: dto.name,
            platform: dto.platform,
            capabilities,
            boundPrinterId,
          },
        });
        if (changed.count !== 1) this.stateChanged();
        const updated = await tx.merchantTerminal.findUniqueOrThrow({
          where: { id },
        });
        await this.audit.record(
          {
            merchantId,
            actorStaffId,
            action: 'TERMINAL_UPDATED',
            resourceType: 'MerchantTerminal',
            resourceId: id,
            beforeData: this.auditView(existing),
            afterData: this.auditView(updated),
            requestId,
          },
          tx,
        );
        return updated;
      });
      return this.serialize(terminal);
    } catch (error) {
      if (isUniqueViolation(error)) this.bindingConflict();
      throw error;
    }
  }

  async revoke(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    if (existing.status === 'REVOKED') return this.serialize(existing);
    const terminal = await this.prisma.$transaction(async (tx) => {
      await quarantineTerminalJobs(tx, id);
      const changed = await tx.merchantTerminal.updateMany({
        where: {
          id,
          merchantId,
          status: existing.status,
          tokenVersion: existing.tokenVersion,
          revokedAt: null,
        },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          tokenHash: null,
          tokenIssuedAt: null,
          tokenExpiresAt: null,
          pairingId: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
          deviceIdentifier: null,
          boundPrinterId: null,
          tokenVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) this.stateChanged();
      const updated = await tx.merchantTerminal.findUniqueOrThrow({
        where: { id },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'TERMINAL_REVOKED',
          resourceType: 'MerchantTerminal',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(terminal);
  }

  disable(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    return this.setEnabled(merchantId, actorStaffId, requestId, id, false);
  }

  enable(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    return this.setEnabled(merchantId, actorStaffId, requestId, id, true);
  }

  async resetUsbConfig(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.STATE_CONFLICT,
        message: '已撤销终端不能接收远程配置命令',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const requestedAt = new Date();
      const changed = await tx.merchantTerminal.updateMany({
        where: {
          id,
          merchantId,
          status: existing.status,
          tokenVersion: existing.tokenVersion,
          revokedAt: null,
        },
        data: {
          configVersion: { increment: 1 },
          resetUsbRequestedAt: requestedAt,
          resetUsbAcknowledgedAt: null,
        },
      });
      if (changed.count !== 1) this.stateChanged();
      const updated = await tx.merchantTerminal.findUniqueOrThrow({
        where: { id },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'TERMINAL_USB_RESET_REQUESTED',
          resourceType: 'MerchantTerminal',
          resourceId: id,
          beforeData: { configVersion: existing.configVersion },
          afterData: {
            configVersion: updated.configVersion,
            requestedAt,
          },
          requestId,
        },
        tx,
      );
      return this.serialize(updated);
    });
  }

  private async setEnabled(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    enabled: boolean,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.STATE_CONFLICT,
        message: '已撤销终端不能重新启用',
      });
    }
    if (
      enabled &&
      (!existing.tokenHash ||
        !existing.tokenExpiresAt ||
        existing.tokenExpiresAt <= new Date())
    ) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.STATE_CONFLICT,
        message: '终端没有有效独立凭据，请先重新绑定',
      });
    }
    const terminal = await this.prisma.$transaction(async (tx) => {
      if (!enabled) await quarantineTerminalJobs(tx, id);
      const changed = await tx.merchantTerminal.updateMany({
        where: {
          id,
          merchantId,
          status: existing.status,
          tokenVersion: existing.tokenVersion,
          revokedAt: null,
        },
        data: { status: enabled ? 'ACTIVE' : 'DISABLED' },
      });
      if (changed.count !== 1) this.stateChanged();
      const updated = await tx.merchantTerminal.findUniqueOrThrow({
        where: { id },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: enabled ? 'TERMINAL_ENABLED' : 'TERMINAL_DISABLED',
          resourceType: 'MerchantTerminal',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(terminal);
  }

  private async requireOwned(merchantId: bigint, id: bigint) {
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id, merchantId },
    });
    if (!terminal) {
      throw new NotFoundException({
        code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: '商家终端不存在',
      });
    }
    return terminal;
  }

  private async validateBoundPrinter(
    merchantId: bigint,
    printerId: bigint,
    currentTerminalId?: bigint,
  ) {
    const [printer, occupied] = await Promise.all([
      this.prisma.printer.findFirst({
        where: {
          id: printerId,
          merchantId,
          channelType: 'LOCAL_USB_ESCPOS',
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.merchantTerminal.findFirst({
        where: {
          boundPrinterId: printerId,
          id: currentTerminalId ? { not: currentTerminalId } : undefined,
        },
        select: { id: true },
      }),
    ]);
    if (!printer) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端只能绑定同一商家的 USB ESC/POS 打印机',
      });
    }
    if (occupied) this.bindingConflict();
  }

  private bindingConflict(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.STATE_CONFLICT,
      message: '该打印机已绑定其他终端，请先解除原绑定',
    });
  }

  private stateChanged(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.STATE_CONFLICT,
      message: '终端状态已变更，请刷新后重试',
    });
  }

  private serialize<
    T extends {
      status: string;
      lastSeenAt: Date | null;
      lastErrorMessage?: string | null;
    },
  >(terminal: T) {
    const unsafe = terminal as T & {
      tokenHash?: unknown;
      pairingCodeHash?: unknown;
      pairingId?: unknown;
    };
    const {
      tokenHash: _tokenHash,
      pairingCodeHash: _pairingCodeHash,
      pairingId: _pairingId,
      ...safe
    } = unsafe;
    // DISABLED is an execution state, not a connectivity state. A disabled
    // connector may keep heartbeat/config access so it can be diagnosed and
    // safely re-enabled without rotating its credential.
    const online =
      ['ACTIVE', 'DISABLED'].includes(terminal.status) &&
      terminal.lastSeenAt !== null &&
      Date.now() - terminal.lastSeenAt.getTime() <= this.onlineThresholdMs();
    const result = {
      ...safe,
      lastErrorMessage: sanitizePrintingError(terminal.lastErrorMessage),
      pairingState: terminal.status === 'UNPAIRED' ? 'NOT_PAIRED' : terminal.status,
      onlineState: online ? 'ONLINE' : 'OFFLINE',
    };
    if ('attempts' in result && Array.isArray(result.attempts)) {
      return {
        ...result,
        attempts: result.attempts.map((attempt) =>
          attempt && typeof attempt === 'object'
            ? {
                ...attempt,
                errorMessage: sanitizePrintingError(
                  (attempt as { errorMessage?: string | null }).errorMessage,
                ),
              }
            : attempt,
        ),
      };
    }
    return result;
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '商家终端不存在',
    });
  }

  private assertNoSecrets(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: '终端能力信息不允许保存密钥字段',
        });
      }
      this.assertNoSecrets(nested);
    }
  }

  private normalizeCapabilities(value: Record<string, unknown>) {
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
            ? '终端能力信息过大'
            : '终端能力信息必须是有效 JSON',
      });
    }
  }

  private auditView(terminal: {
    id: bigint;
    name: string;
    platform: string;
    status: string;
    appVersion: string | null;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
  }) {
    return {
      id: terminal.id.toString(),
      name: terminal.name,
      platform: terminal.platform,
      status: terminal.status,
      appVersion: terminal.appVersion,
      lastSeenAt: terminal.lastSeenAt,
      revokedAt: terminal.revokedAt,
    };
  }

  private onlineThresholdMs() {
    const configured = Number(
      this.config.get<string>('TERMINAL_HEARTBEAT_SECONDS'),
    );
    const heartbeatSeconds = Number.isInteger(configured)
      ? Math.min(60, Math.max(10, configured))
      : 20;
    return Math.max(30, heartbeatSeconds * 3) * 1_000;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}
