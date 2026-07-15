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

export interface StartPrintingInput {
  merchantId: bigint;
  terminalId: bigint;
  jobId: bigint;
  leaseVersion: number;
  adapter: string;
  appVersion?: string;
  networkInfo?: Record<string, unknown>;
}

export interface FinishPrintingInput {
  merchantId: bigint;
  terminalId: bigint;
  jobId: bigint;
  attemptNo: number;
  leaseVersion: number;
  printerResponse?: string;
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
  ) {}

  async markPrinting(input: StartPrintingInput) {
    this.assertExecution();
    await this.requireActiveTerminal(input.merchantId, input.terminalId);
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
      this.assertLeaseOwner(job, input.terminalId, ['CLAIMED']);
      if (job.attemptCount >= job.maxAttempts) {
        this.stateConflict('任务已达到最大尝试次数');
      }
      const attemptNo = job.attemptCount + 1;
      const changed = await tx.printJob.updateMany({
        where: {
          id: job.id,
          merchantId: input.merchantId,
          status: 'CLAIMED',
          claimedByTerminalId: input.terminalId,
          leaseVersion: input.leaseVersion,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'PRINTING',
          attemptCount: { increment: 1 },
          leaseVersion: { increment: 1 },
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
        },
      });
      const updatedJob = await tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
      return { job: updatedJob, attempt };
    });
  }

  async markSucceeded(input: FinishPrintingInput) {
    this.assertExecution();
    await this.requireActiveTerminal(input.merchantId, input.terminalId);
    return this.prisma.$transaction(async (tx) => {
      const job = await this.requireOwnedJob(tx, input.merchantId, input.jobId);
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
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
      return tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async markFailed(input: FailPrintingInput) {
    this.assertExecution();
    await this.requireActiveTerminal(input.merchantId, input.terminalId);
    return this.prisma.$transaction(async (tx) => {
      const job = await this.requireOwnedJob(tx, input.merchantId, input.jobId);
      const outcomeUnknown =
        input.errorCode === PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN;
      const expectedResult = outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED';
      const expectedStatus =
        !outcomeUnknown && input.retryable && job.attemptCount < job.maxAttempts
          ? 'RETRY_WAIT'
          : 'FAILED';
      if (['RETRY_WAIT', 'FAILED'].includes(job.status)) {
        const completedAttempt = await tx.printAttempt.findFirst({
          where: {
            jobId: job.id,
            attemptNo: input.attemptNo,
            terminalId: input.terminalId,
          },
        });
        if (
          completedAttempt &&
          completedAttempt.result === expectedResult &&
          completedAttempt.errorCode === input.errorCode &&
          completedAttempt.errorMessage === sanitizePrintingError(input.errorMessage) &&
          completedAttempt.printerResponse === sanitizePrintingError(input.printerResponse) &&
          job.status === expectedStatus
        ) {
          return job;
        }
        this.stateConflict('重复失败回报与已记录尝试不一致');
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
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
      return tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async extendLease(
    merchantId: bigint,
    terminalId: bigint,
    jobId: bigint,
    expectedLeaseVersion: number,
    leaseMs = 30_000,
  ) {
    this.assertExecution();
    await this.requireActiveTerminal(merchantId, terminalId);
    const job = await this.prisma.printJob.findFirst({ where: { id: jobId, merchantId } });
    if (!job) this.notFound();
    this.assertLeaseOwner(job, terminalId, ['CLAIMED', 'PRINTING']);
    const now = new Date();
    const changed = await this.prisma.printJob.updateMany({
      where: {
        id: jobId,
        merchantId,
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

  private assertLeaseOwner(
    job: {
      status: string;
      claimedByTerminalId: bigint | null;
      leaseExpiresAt: Date | null;
    },
    terminalId: bigint,
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
