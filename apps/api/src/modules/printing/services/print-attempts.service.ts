import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PRINTING_ERROR_CODES,
  PrintingErrorCode,
  sanitizePrintingError,
} from '../types/printing-errors';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { receiptSnapshotHash } from '../utils/snapshot-hash';
import { isReadyPrinter } from '../utils/printer-readiness';
import { PrintingSettingsService } from './printing-settings.service';

export interface StartPrintingInput {
  merchantId: bigint;
  terminalId: bigint | null;
  jobId: bigint;
  leaseVersion: number;
  adapter: string;
  appVersion?: string;
  networkInfo?: Record<string, unknown>;
  contentHash?: string;
}

export interface FinishPrintingInput {
  merchantId: bigint;
  terminalId: bigint | null;
  jobId: bigint;
  attemptNo: number;
  leaseVersion: number;
  printerResponse?: string;
  contentHash?: string;
  bytesWritten?: number;
}

export interface FailPrintingInput extends FinishPrintingInput {
  retryable: boolean;
  errorCode: PrintingErrorCode;
  errorMessage: string;
}

@Injectable()
export class PrintAttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
  ) {}

  async markPrinting(input: StartPrintingInput) {
    this.assertExecution();
    if (input.terminalId !== null) {
      await this.requireActiveTerminal(input.merchantId, input.terminalId);
    }
    const adapter = input.adapter.trim();
    if (!adapter) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '打印适配器标识不能为空',
      });
    }
    const networkInfo = normalizeNetworkInfo(input.networkInfo);
    return this.prisma.$transaction(async (tx) => {
      const job = await this.requireOwnedJob(tx, input.merchantId, input.jobId);
      await this.assertStartStillEnabled(
        tx,
        input.merchantId,
        input.terminalId,
        job.printerId,
      );
      const expectedHash = this.assertContentHash(job, input.contentHash);
      if (input.adapter !== 'ANDROID_USB_ESCPOS') {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
          message: '本阶段终端只允许 Android USB ESC/POS 适配器',
        });
      }
      if (job.status === 'PRINTING' && job.claimedByTerminalId === input.terminalId) {
        const existingAttempt = await tx.printAttempt.findFirst({
          where: {
            jobId: job.id,
            attemptNo: job.attemptCount,
            terminalId: input.terminalId,
            finishedAt: null,
            adapter: input.adapter,
            contentHash: expectedHash,
          },
        });
        if (existingAttempt && job.leaseExpiresAt && job.leaseExpiresAt > new Date()) {
          return { job, attempt: existingAttempt };
        }
      }
      this.assertLeaseOwner(job, input.terminalId, ['CLAIMED']);
      if (job.attemptCount >= job.maxAttempts) {
        this.stateConflict('任务已达到最大尝试次数');
      }
      const attemptNo = job.attemptCount + 1;
      const changed = await tx.printJob.updateMany({
        where: {
          id: job.id,
          merchantId: input.merchantId,
          merchant: { status: 'ACTIVE', printingEnabled: true },
          status: 'CLAIMED',
          claimedByTerminalId: input.terminalId,
          leaseVersion: input.leaseVersion,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'PRINTING',
          attemptCount: { increment: 1 },
          leaseVersion: { increment: 1 },
          receiptSnapshotHash: job.receiptSnapshotHash ?? expectedHash,
        },
      });
      if (changed.count !== 1) this.leaseConflict();
      const attempt = await tx.printAttempt.create({
        data: {
          jobId: job.id,
          attemptNo,
          executorType: 'TERMINAL',
          terminalId: input.terminalId,
          adapter: adapter.slice(0, 80),
          appVersion: input.appVersion?.slice(0, 64),
          networkInfo,
          contentHash: expectedHash,
        },
      });
      const updatedJob = await tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
      return { job: updatedJob, attempt };
    });
  }

  async markSucceeded(input: FinishPrintingInput) {
    // Completion reports reconcile an attempt that already reached hardware.
    // They intentionally remain accepted after the platform gate closes so a
    // real output is not left as an unknown/orphaned attempt.
    this.assertExecution();
    if (input.terminalId !== null) {
      await this.requireActiveTerminal(input.merchantId, input.terminalId);
    }
    return this.prisma.$transaction(async (tx) => {
      const job = await this.requireOwnedJob(tx, input.merchantId, input.jobId);
      const expectedHash = this.assertContentHash(job, input.contentHash);
      if (job.status === 'SUCCEEDED') {
        const completedAttempt = await tx.printAttempt.findFirst({
          where: {
            jobId: job.id,
            attemptNo: input.attemptNo,
            terminalId: input.terminalId,
            result: 'SUCCEEDED',
          },
        });
        if (
          completedAttempt &&
          completedAttempt.printerResponse === sanitizePrintingError(input.printerResponse)
          && (input.contentHash === undefined || completedAttempt.contentHash === expectedHash)
          && (input.bytesWritten === undefined || completedAttempt.bytesWritten === input.bytesWritten)
        ) {
          return job;
        }
        this.stateConflict('重复成功回报与已记录尝试不一致');
      }
      this.assertLeaseOwner(job, input.terminalId, ['PRINTING']);
      this.assertCurrentAttempt(job.attemptCount, input.attemptNo);
      const now = new Date();
      const changed = await tx.printJob.updateMany({
        where: {
          id: job.id,
          merchantId: input.merchantId,
          status: 'PRINTING',
          claimedByTerminalId: input.terminalId,
          leaseVersion: input.leaseVersion,
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: 'SUCCEEDED',
          completedAt: now,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          retryBlocked: false,
          leaseVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) this.leaseConflict();
      const attempt = await tx.printAttempt.updateMany({
        where: {
          jobId: job.id,
          attemptNo: input.attemptNo,
          terminalId: input.terminalId,
          finishedAt: null,
        },
        data: {
          finishedAt: now,
          result: 'SUCCEEDED',
          printerResponse: sanitizePrintingError(input.printerResponse),
          contentHash: expectedHash,
          bytesWritten: input.bytesWritten,
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
      await tx.printer.updateMany({
        where: { id: job.printerId, merchantId: input.merchantId, deletedAt: null },
        data: { status: 'ONLINE' },
      });
      return tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async markFailed(input: FailPrintingInput) {
    // Failure reports are also reconciliation-only and cannot emit output.
    this.assertExecution();
    if (input.terminalId !== null) {
      await this.requireActiveTerminal(input.merchantId, input.terminalId);
    }
    return this.prisma.$transaction(async (tx) => {
      const job = await this.requireOwnedJob(tx, input.merchantId, input.jobId);
      const expectedHash = this.assertContentHash(job, input.contentHash);
      const outcomeUnknown =
        input.errorCode === PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN;
      const expectedResult = outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED';
      const completedAttempt = await tx.printAttempt.findFirst({
        where: {
          jobId: job.id,
          attemptNo: input.attemptNo,
          terminalId: input.terminalId,
          finishedAt: { not: null },
        },
      });
      if (completedAttempt) {
        if (
          completedAttempt.result === expectedResult &&
          completedAttempt.errorCode === input.errorCode &&
          completedAttempt.errorMessage === sanitizePrintingError(input.errorMessage) &&
          completedAttempt.printerResponse === sanitizePrintingError(input.printerResponse) &&
          (input.contentHash === undefined || completedAttempt.contentHash === expectedHash) &&
          (input.bytesWritten === undefined || completedAttempt.bytesWritten === input.bytesWritten)
        ) {
          return job;
        }
        this.stateConflict('重复失败回报与已记录尝试不一致');
      }
      if (['RETRY_WAIT', 'FAILED'].includes(job.status)) {
        this.stateConflict('任务已结束当前尝试，但未找到匹配的完成回报');
      }
      this.assertLeaseOwner(job, input.terminalId, ['PRINTING']);
      this.assertCurrentAttempt(job.attemptCount, input.attemptNo);
      const now = new Date();
      const retryable =
        !outcomeUnknown && input.retryable && job.attemptCount < job.maxAttempts;
      const nextStatus = retryable ? 'RETRY_WAIT' : 'FAILED';
      const changed = await tx.printJob.updateMany({
        where: {
          id: job.id,
          merchantId: input.merchantId,
          status: 'PRINTING',
          claimedByTerminalId: input.terminalId,
          leaseVersion: input.leaseVersion,
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: nextStatus,
          availableAt: retryable ? new Date(now.getTime() + retryDelay(job.attemptCount)) : undefined,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          completedAt: retryable ? undefined : now,
          retryBlocked: outcomeUnknown,
          lastErrorCode: input.errorCode,
          lastErrorMessage: sanitizePrintingError(input.errorMessage),
        },
      });
      if (changed.count !== 1) this.leaseConflict();
      const attempt = await tx.printAttempt.updateMany({
        where: {
          jobId: job.id,
          attemptNo: input.attemptNo,
          terminalId: input.terminalId,
          finishedAt: null,
        },
        data: {
          finishedAt: now,
          result: outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
          errorCode: input.errorCode,
          errorMessage: sanitizePrintingError(input.errorMessage),
          printerResponse: sanitizePrintingError(input.printerResponse),
          contentHash: expectedHash,
          bytesWritten: input.bytesWritten,
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
      await tx.printer.updateMany({
        where: { id: job.printerId, merchantId: input.merchantId, deletedAt: null },
        data: {
          status: outcomeUnknown
            ? 'UNKNOWN'
            : input.errorCode === PRINTING_ERROR_CODES.PRINTER_OFFLINE ||
                input.errorCode === PRINTING_ERROR_CODES.USB_DEVICE_DETACHED
              ? 'OFFLINE'
              : 'ERROR',
        },
      });
      return tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async extendLease(
    merchantId: bigint,
    terminalId: bigint | null,
    jobId: bigint,
    expectedLeaseVersion: number,
    leaseMs = 30_000,
  ) {
    this.assertExecution();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    if (terminalId !== null) {
      await this.requireActiveTerminal(merchantId, terminalId);
    }
    const job = await this.prisma.printJob.findFirst({ where: { id: jobId, merchantId } });
    if (!job) this.notFound();
    this.assertLeaseOwner(job, terminalId, ['CLAIMED', 'PRINTING']);
    const now = new Date();
    const changed = await this.prisma.printJob.updateMany({
      where: {
        id: jobId,
        merchantId,
        merchant: { status: 'ACTIVE', printingEnabled: true },
        status: { in: ['CLAIMED', 'PRINTING'] },
        claimedByTerminalId: terminalId,
        leaseVersion: expectedLeaseVersion,
        leaseExpiresAt: { gt: now },
      },
      data: {
        leaseExpiresAt: new Date(now.getTime() + Math.min(120_000, Math.max(5_000, leaseMs))),
        leaseVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) this.leaseConflict();
    return this.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  private assertExecution() {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
  }

  private async requireActiveTerminal(merchantId: bigint, terminalId: bigint) {
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id: terminalId, merchantId, status: 'ACTIVE', revokedAt: null },
      select: { id: true },
    });
    if (!terminal) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '终端未启用或不属于当前商家',
      });
    }
  }

  private async requireOwnedJob(
    client: Prisma.TransactionClient,
    merchantId: bigint,
    jobId: bigint,
  ) {
    const job = await client.printJob.findFirst({ where: { id: jobId, merchantId } });
    if (!job) this.notFound();
    return job;
  }

  private async assertStartStillEnabled(
    client: Prisma.TransactionClient,
    merchantId: bigint,
    terminalId: bigint | null,
    printerId: bigint,
  ) {
    await this.settings.assertMerchantPrintingEnabled(merchantId, client);
    if (terminalId === null) {
      const printer = await client.printer.findFirst({
        where: {
          id: printerId,
          merchantId,
          deletedAt: null,
        },
        select: {
          id: true,
          channelType: true,
          enabled: true,
          status: true,
          connectionConfig: true,
          capabilities: true,
        },
      });
      if (!printer || !isReadyPrinter(printer)) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.PRINTER_OFFLINE,
          message: 'USB 打印设备尚无明确可用证据',
        });
      }
      return;
    }

    const terminal = await client.merchantTerminal.findFirst({
      where: {
        id: terminalId,
        merchantId,
        status: 'ACTIVE',
        revokedAt: null,
      },
      select: {
        boundPrinterId: true,
        boundPrinter: {
          select: {
            id: true,
            enabled: true,
            status: true,
            deletedAt: true,
            channelType: true,
            connectionConfig: true,
            capabilities: true,
          },
        },
      },
    });
    if (!terminal) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '终端未启用或不属于当前商家',
      });
    }
    if (
      terminal.boundPrinterId !== printerId ||
      !terminal.boundPrinter ||
      terminal.boundPrinter.deletedAt ||
      !isReadyPrinter(terminal.boundPrinter)
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        message: '绑定的 USB 打印设备尚无明确可用证据',
      });
    }
  }

  private assertLeaseOwner(
    job: {
      status: string;
      claimedByTerminalId: bigint | null;
      leaseExpiresAt: Date | null;
    },
    terminalId: bigint | null,
    allowedStatuses: string[],
  ) {
    if (!allowedStatuses.includes(job.status) || job.claimedByTerminalId !== terminalId) {
      this.stateConflict('任务状态或租约所有者不匹配');
    }
    if (!job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) {
      this.leaseConflict();
    }
  }

  private assertCurrentAttempt(currentAttemptNo: number, reportedAttemptNo: number) {
    if (!Number.isInteger(reportedAttemptNo) || reportedAttemptNo !== currentAttemptNo) {
      this.stateConflict('打印回报的尝试序号与当前任务不匹配');
    }
  }

  private assertContentHash(
    job: { receiptSnapshot: unknown; receiptSnapshotHash: string | null },
    received: string | undefined,
  ) {
    const expected =
      job.receiptSnapshotHash ?? receiptSnapshotHash(job.receiptSnapshot);
    if (received !== undefined && received !== expected) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.CONTENT_HASH_MISMATCH,
        message: '小票快照哈希不匹配，已拒绝执行或回报',
      });
    }
    return expected;
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '打印任务不存在',
    });
  }

  private leaseConflict(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.LEASE_EXPIRED,
      message: '打印任务租约已失效，请停止执行并重新领取',
    });
  }

  private stateConflict(message: string): never {
    throw new ConflictException({ code: PRINTING_ERROR_CODES.STATE_CONFLICT, message });
  }
}

function retryDelay(attemptNo: number) {
  return Math.min(300_000, 5_000 * 2 ** Math.max(0, attemptNo - 1));
}

function normalizeNetworkInfo(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  assertNoSensitiveKeys(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 4_096) {
      throw new Error('network information exceeds 4096 bytes');
    }
    return JSON.parse(serialized) as Prisma.InputJsonObject;
  } catch (error) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message:
        error instanceof Error && error.message.includes('4096')
          ? '网络诊断信息过大'
          : '网络诊断信息必须是有效 JSON',
    });
  }
}

function assertNoSensitiveKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '网络诊断信息不允许包含敏感字段',
      });
    }
    assertNoSensitiveKeys(nested);
  }
}
