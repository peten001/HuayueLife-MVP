import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrinterChannelType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../../../database/prisma.service';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { receiptSnapshotHash } from '../utils/snapshot-hash';
import { isApiShadowDiagnosticMode } from '../../../common/config/shadow-diagnostic';
import {
  CloudPrintingService,
  CloudProvider,
  CloudProviderError,
} from './cloud-printing.service';
import { renderCloudReceipt } from './cloud-receipt-renderer';
import { PrintJobsService } from './print-jobs.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

const CLOUD_CHANNELS: PrinterChannelType[] = ['CLOUD_FEIE', 'CLOUD_YILIAN'];
const CLOUD_ATTEMPT_ADAPTERS = ['FEIE_CLOUD', 'YILIAN_CLOUD'] as const;

type CloudChannel = 'CLOUD_FEIE' | 'CLOUD_YILIAN';

type ClaimedCloudExecution = {
  job: {
    id: bigint;
    merchantId: bigint;
    printerId: bigint;
    receiptSnapshot: Prisma.JsonValue;
    receiptSnapshotHash: string | null;
    attemptCount: number;
    maxAttempts: number;
    leaseVersion: number;
    printer: {
      channelType: CloudChannel;
      connectionConfig: Prisma.JsonValue;
      capabilities: Prisma.JsonValue;
    };
  };
  attempt: {
    id: bigint;
    attemptNo: number;
    providerRequestId: string;
  };
};

type PollableCloudExecution = {
  job: {
    id: bigint;
    merchantId: bigint;
    printerId: bigint;
    leaseVersion: number;
    maxAttempts: number;
    attemptCount: number;
    printer: {
      channelType: CloudChannel;
      connectionConfig: Prisma.JsonValue;
      capabilities: Prisma.JsonValue;
    };
  };
  attempt: {
    id: bigint;
    attemptNo: number;
    providerTaskId: string;
    providerSubmittedAt: Date;
    cloudStatus: 'SUBMITTED' | 'ACCEPTED';
  };
};

@Injectable()
export class CloudPrintExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(CloudPrintExecutionService.name);
  private readonly executorId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
    .slice(0, 128);
  private nextScheduledRunAt = 0;
  private scheduledRunActive = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly jobs: PrintJobsService,
    private readonly providers: CloudPrintingService,
  ) {}

  status() {
    return {
      enabled: this.workerEnabled(),
      pollIntervalMs: this.pollIntervalMs(),
      leaseTimeoutMs: this.leaseTimeoutMs(),
      maxBatch: this.maxBatch(),
      providers: this.providers.configurationStatus(),
    };
  }

  @Interval(1_000)
  async scheduledRun() {
    if (this.stopped || !this.workerEnabled() || this.scheduledRunActive) return;
    const now = Date.now();
    if (now < this.nextScheduledRunAt) return;
    this.nextScheduledRunAt = now + this.pollIntervalMs();
    this.scheduledRunActive = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        `Cloud worker cycle failed: ${safeWorkerError(error)}`,
      );
    } finally {
      this.scheduledRunActive = false;
    }
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  async runOnce() {
    if (!this.workerEnabled() || this.stopped) {
      return { enabled: false, recovered: 0, submitted: 0, polled: 0 };
    }
    if (!this.flags.taskCenterEnabled() || !this.flags.executionEnabled()) {
      return { enabled: true, recovered: 0, submitted: 0, polled: 0 };
    }

    const recovered = await this.recoverExpiredCloudSubmissions();
    await this.jobs.releaseAvailableRetries(new Date());
    await this.processPendingAutomaticTriggers();

    const claimed = await this.claimPendingCloudJobs();
    let submitted = 0;
    for (const execution of claimed) {
      await this.executeSubmission(execution);
      submitted += 1;
    }

    const pollable = await this.claimDueStatusQueries();
    let polled = 0;
    for (const execution of pollable) {
      await this.executeStatusQuery(execution);
      polled += 1;
    }
    return { enabled: true, recovered, submitted, polled };
  }

  private async processPendingAutomaticTriggers() {
    if (!this.flags.automaticCreationEnabled()) return;
    const merchants = await this.prisma.printTriggerOutbox.findMany({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      distinct: ['merchantId'],
      select: { merchantId: true },
      take: this.maxBatch(),
    });
    for (const { merchantId } of merchants) {
      await this.jobs.processPendingAutomaticTriggers(merchantId, this.maxBatch());
    }
  }

  private async claimPendingCloudJobs() {
    const now = new Date();
    const automaticAllowed = this.flags.automaticCreationEnabled();
    const candidates = await this.prisma.printJob.findMany({
      where: {
        status: 'PENDING',
        availableAt: { lte: now },
        retryBlocked: false,
        merchant: { status: 'ACTIVE', printingEnabled: true },
        printer: {
          enabled: true,
          deletedAt: null,
          channelType: { in: CLOUD_CHANNELS },
        },
        OR: [
          { source: { in: ['MANUAL', 'MANUAL_REPRINT', 'TEST'] } },
          ...(automaticAllowed
            ? [{ source: 'AUTOMATIC' as const, printRule: { enabled: true, autoPrint: true } }]
            : []),
        ],
      },
      select: {
        id: true,
        merchantId: true,
        leaseVersion: true,
        attemptCount: true,
        maxAttempts: true,
      },
      orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }, { id: 'asc' }],
      take: this.maxBatch(),
    });

    const claimed: ClaimedCloudExecution[] = [];
    for (const candidate of candidates) {
      if (candidate.attemptCount >= candidate.maxAttempts) continue;
      const execution = await this.prisma.$transaction(async (tx) => {
        const job = await tx.printJob.findFirst({
          where: {
            id: candidate.id,
            merchantId: candidate.merchantId,
            status: 'PENDING',
            leaseVersion: candidate.leaseVersion,
            retryBlocked: false,
            merchant: { status: 'ACTIVE', printingEnabled: true },
            printer: {
              enabled: true,
              deletedAt: null,
              channelType: { in: CLOUD_CHANNELS },
            },
          },
          include: {
            printer: {
              select: {
                channelType: true,
                connectionConfig: true,
                capabilities: true,
              },
            },
          },
        });
        if (!job || !isCloudChannel(job.printer.channelType)) return null;
        const contentHash =
          job.receiptSnapshotHash ?? receiptSnapshotHash(job.receiptSnapshot);
        const attemptNo = job.attemptCount + 1;
        const changed = await tx.printJob.updateMany({
          where: {
            id: job.id,
            merchantId: job.merchantId,
            status: 'PENDING',
            leaseVersion: job.leaseVersion,
            attemptCount: job.attemptCount,
            merchant: { status: 'ACTIVE', printingEnabled: true },
            printer: {
              enabled: true,
              deletedAt: null,
              channelType: { in: CLOUD_CHANNELS },
            },
          },
          data: {
            status: 'PRINTING',
            claimedAt: now,
            claimedByTerminalId: null,
            leaseExpiresAt: new Date(now.getTime() + this.leaseTimeoutMs()),
            leaseVersion: { increment: 1 },
            attemptCount: { increment: 1 },
            receiptSnapshotHash: contentHash,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (changed.count !== 1) return null;
        const provider = providerForChannel(job.printer.channelType);
        const providerRequestId = cloudProviderRequestId(
          job.id,
          attemptNo,
          contentHash,
        );
        const attempt = await tx.printAttempt.create({
          data: {
            jobId: job.id,
            attemptNo,
            executorType: 'SERVER_ADAPTER',
            terminalId: null,
            adapter: adapterForProvider(provider),
            cloudStatus: 'SUBMITTING',
            executorId: this.executorId,
            providerRequestId,
            contentHash,
          },
        });
        const updatedJob = await tx.printJob.findUniqueOrThrow({
          where: { id: job.id },
          include: {
            printer: {
              select: {
                channelType: true,
                connectionConfig: true,
                capabilities: true,
              },
            },
          },
        });
        if (!isCloudChannel(updatedJob.printer.channelType)) return null;
        return {
          job: {
            id: updatedJob.id,
            merchantId: updatedJob.merchantId,
            printerId: updatedJob.printerId,
            receiptSnapshot: updatedJob.receiptSnapshot,
            receiptSnapshotHash: updatedJob.receiptSnapshotHash,
            attemptCount: updatedJob.attemptCount,
            maxAttempts: updatedJob.maxAttempts,
            leaseVersion: updatedJob.leaseVersion,
            printer: {
              channelType: updatedJob.printer.channelType,
              connectionConfig: updatedJob.printer.connectionConfig,
              capabilities: updatedJob.printer.capabilities,
            },
          },
          attempt: {
            id: attempt.id,
            attemptNo: attempt.attemptNo,
            providerRequestId,
          },
        } satisfies ClaimedCloudExecution;
      });
      if (execution) claimed.push(execution);
    }
    return claimed;
  }

  private async executeSubmission(execution: ClaimedCloudExecution) {
    const provider = providerForChannel(execution.job.printer.channelType);
    const deviceId = deviceIdForPrinter(
      execution.job.printer.channelType,
      execution.job.printer.connectionConfig,
    );
    if (!deviceId) {
      await this.finishSubmissionFailure(
        execution,
        new CloudProviderError(
          PRINTING_ERROR_CODES.CONFIG_INVALID,
          '云打印设备号尚未配置',
          { retryable: false },
        ),
      );
      return;
    }

    try {
      if (!this.providers.isConfigured(provider)) {
        throw new CloudProviderError(
          PRINTING_ERROR_CODES.CLOUD_PROVIDER_NOT_CONFIGURED,
          `${provider === 'FEIE' ? '飞鹅' : '易联云'}服务尚未配置`,
          { retryable: false, notConfigured: true },
        );
      }
      const printerStatus = await this.providers.queryPrinter(provider, deviceId);
      await this.persistPrinterStatus(execution.job, printerStatus);
      if (printerStatus !== 'ONLINE') {
        throw new CloudProviderError(
          PRINTING_ERROR_CODES.PRINTER_OFFLINE,
          printerStatus === 'OFFLINE' ? '云打印机当前离线' : '云打印机当前异常',
          { retryable: true },
        );
      }
      const content = renderCloudReceipt(execution.job.receiptSnapshot, provider);
      const submission = await this.providers.submit(
        provider,
        deviceId,
        content,
        execution.attempt.providerRequestId,
      );
      try {
        await this.persistSubmitted(execution, submission.providerTaskId);
      } catch {
        throw new CloudProviderError(
          PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
          '厂商已返回任务号，但本地状态保存失败，打印结果暂时无法确认',
          { retryable: false, outcomeUnknown: true },
        );
      }
      this.logger.log(
        `Cloud task submitted provider=${provider} job=${execution.job.id.toString()}`,
      );
    } catch (error) {
      await this.finishSubmissionFailure(execution, asProviderError(error));
    }
  }

  private async persistSubmitted(
    execution: ClaimedCloudExecution,
    providerTaskId: string,
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.printAttempt.updateMany({
        where: {
          id: execution.attempt.id,
          jobId: execution.job.id,
          attemptNo: execution.attempt.attemptNo,
          finishedAt: null,
          cloudStatus: 'SUBMITTING',
          providerTaskId: null,
        },
        data: {
          cloudStatus: 'SUBMITTED',
          providerTaskId: providerTaskId.slice(0, 191),
          providerSubmittedAt: now,
          providerCheckedAt: now,
          printerResponse: '云打印任务已提交，等待厂商确认打印结果',
        },
      });
      if (attempt.count !== 1) throw new Error('cloud attempt state changed');
      const job = await tx.printJob.updateMany({
        where: {
          id: execution.job.id,
          merchantId: execution.job.merchantId,
          status: 'PRINTING',
          leaseVersion: execution.job.leaseVersion,
        },
        data: {
          leaseExpiresAt: new Date(now.getTime() + this.statusQueryIntervalMs()),
          leaseVersion: { increment: 1 },
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (job.count !== 1) throw new Error('cloud job lease changed');
    });
  }

  private async finishSubmissionFailure(
    execution: ClaimedCloudExecution,
    error: CloudProviderError,
  ) {
    const now = new Date();
    const unknown = error.options.outcomeUnknown === true;
    const retryable =
      !unknown &&
      error.options.retryable &&
      execution.job.attemptCount < execution.job.maxAttempts;
    const cloudStatus = error.options.notConfigured
      ? 'NOT_CONFIGURED'
      : unknown
        ? 'UNKNOWN'
        : 'FAILED';
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.printAttempt.updateMany({
        where: {
          id: execution.attempt.id,
          jobId: execution.job.id,
          attemptNo: execution.attempt.attemptNo,
          finishedAt: null,
          cloudStatus: 'SUBMITTING',
        },
        data: {
          finishedAt: now,
          result: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
          cloudStatus,
          errorCode: error.code,
          errorMessage: sanitizePrintingError(error.message),
          printerResponse: error.options.providerCode
            ? `provider_code=${error.options.providerCode}`
            : undefined,
        },
      });
      if (attempt.count !== 1) return;
      await tx.printJob.updateMany({
        where: {
          id: execution.job.id,
          merchantId: execution.job.merchantId,
          status: 'PRINTING',
          leaseVersion: execution.job.leaseVersion,
        },
        data: {
          status: retryable ? 'RETRY_WAIT' : 'FAILED',
          availableAt: retryable
            ? new Date(now.getTime() + retryDelay(execution.job.attemptCount))
            : undefined,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          completedAt: retryable ? undefined : now,
          retryBlocked: unknown,
          lastErrorCode: error.code,
          lastErrorMessage: sanitizePrintingError(error.message),
        },
      });
    });
    this.logger.warn(
      `Cloud submission ended provider=${providerForChannel(execution.job.printer.channelType)} job=${execution.job.id.toString()} state=${cloudStatus} code=${error.code}`,
    );
  }

  private async claimDueStatusQueries() {
    const now = new Date();
    const candidates = await this.prisma.printJob.findMany({
      where: {
        status: 'PRINTING',
        leaseExpiresAt: { lte: now },
        printer: { channelType: { in: CLOUD_CHANNELS }, deletedAt: null },
        attempts: {
          some: {
            finishedAt: null,
            cloudStatus: { in: ['SUBMITTED', 'ACCEPTED'] },
            providerTaskId: { not: null },
          },
        },
      },
      select: { id: true, merchantId: true, leaseVersion: true },
      orderBy: [{ leaseExpiresAt: 'asc' }, { id: 'asc' }],
      take: this.maxBatch(),
    });
    const claimed: PollableCloudExecution[] = [];
    for (const candidate of candidates) {
      const changed = await this.prisma.printJob.updateMany({
        where: {
          id: candidate.id,
          merchantId: candidate.merchantId,
          status: 'PRINTING',
          leaseVersion: candidate.leaseVersion,
          leaseExpiresAt: { lte: now },
        },
        data: {
          leaseExpiresAt: new Date(now.getTime() + this.leaseTimeoutMs()),
          leaseVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) continue;
      const job = await this.prisma.printJob.findUnique({
        where: { id: candidate.id },
        include: {
          printer: {
            select: {
              channelType: true,
              connectionConfig: true,
              capabilities: true,
            },
          },
          attempts: {
            where: {
              finishedAt: null,
              cloudStatus: { in: ['SUBMITTED', 'ACCEPTED'] },
              providerTaskId: { not: null },
            },
            orderBy: { attemptNo: 'desc' },
            take: 1,
          },
        },
      });
      const attempt = job?.attempts[0];
      if (
        !job ||
        !attempt ||
        !isCloudChannel(job.printer.channelType) ||
        !attempt.providerTaskId ||
        !attempt.providerSubmittedAt ||
        (attempt.cloudStatus !== 'SUBMITTED' && attempt.cloudStatus !== 'ACCEPTED')
      ) {
        continue;
      }
      claimed.push({
        job: {
          id: job.id,
          merchantId: job.merchantId,
          printerId: job.printerId,
          leaseVersion: job.leaseVersion,
          maxAttempts: job.maxAttempts,
          attemptCount: job.attemptCount,
          printer: {
            channelType: job.printer.channelType,
            connectionConfig: job.printer.connectionConfig,
            capabilities: job.printer.capabilities,
          },
        },
        attempt: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          providerTaskId: attempt.providerTaskId,
          providerSubmittedAt: attempt.providerSubmittedAt,
          cloudStatus: attempt.cloudStatus,
        },
      });
    }
    return claimed;
  }

  private async executeStatusQuery(execution: PollableCloudExecution) {
    const provider = providerForChannel(execution.job.printer.channelType);
    const deviceId = deviceIdForPrinter(
      execution.job.printer.channelType,
      execution.job.printer.connectionConfig,
    );
    if (!deviceId) {
      await this.finishPolledUnknown(execution, '云打印设备号已缺失');
      return;
    }
    if (Date.now() - execution.attempt.providerSubmittedAt.getTime() > this.resultTimeoutMs()) {
      await this.finishPolledUnknown(execution, '厂商在限定时间内未确认打印结果');
      return;
    }
    try {
      const status = await this.providers.queryTask(
        provider,
        deviceId,
        execution.attempt.providerTaskId,
      );
      if (status === 'PRINTED') {
        await this.finishPrinted(execution);
        return;
      }
      if (status === 'CANCELLED') {
        await this.finishProviderCancelled(execution);
        return;
      }
      await this.rescheduleStatusQuery(execution, status === 'SUBMITTED' ? 'SUBMITTED' : 'ACCEPTED');
    } catch (error) {
      const providerError = asProviderError(error);
      if (Date.now() - execution.attempt.providerSubmittedAt.getTime() > this.resultTimeoutMs()) {
        await this.finishPolledUnknown(execution, providerError.message);
      } else {
        await this.rescheduleStatusQuery(
          execution,
          execution.attempt.cloudStatus,
          providerError,
        );
      }
    }
  }

  private async rescheduleStatusQuery(
    execution: PollableCloudExecution,
    status: 'SUBMITTED' | 'ACCEPTED',
    error?: CloudProviderError,
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.printAttempt.updateMany({
        where: {
          id: execution.attempt.id,
          jobId: execution.job.id,
          finishedAt: null,
          providerTaskId: execution.attempt.providerTaskId,
          cloudStatus: { in: ['SUBMITTED', 'ACCEPTED'] },
        },
        data: {
          cloudStatus: status,
          providerCheckedAt: now,
          providerCheckCount: { increment: 1 },
          errorCode: error ? error.code : null,
          errorMessage: error ? sanitizePrintingError(error.message) : null,
        },
      });
      if (attempt.count !== 1) return;
      await tx.printJob.updateMany({
        where: {
          id: execution.job.id,
          merchantId: execution.job.merchantId,
          status: 'PRINTING',
          leaseVersion: execution.job.leaseVersion,
        },
        data: {
          leaseExpiresAt: new Date(now.getTime() + this.statusQueryIntervalMs()),
          leaseVersion: { increment: 1 },
          lastErrorCode: error?.code,
          lastErrorMessage: error ? sanitizePrintingError(error.message) : null,
        },
      });
    });
  }

  private async finishPrinted(execution: PollableCloudExecution) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.printAttempt.updateMany({
        where: {
          id: execution.attempt.id,
          jobId: execution.job.id,
          finishedAt: null,
          providerTaskId: execution.attempt.providerTaskId,
          cloudStatus: { in: ['SUBMITTED', 'ACCEPTED'] },
        },
        data: {
          finishedAt: now,
          result: 'SUCCEEDED',
          cloudStatus: 'PRINTED',
          providerCheckedAt: now,
          providerCheckCount: { increment: 1 },
          errorCode: null,
          errorMessage: null,
          printerResponse: '厂商已确认打印完成',
        },
      });
      if (attempt.count !== 1) return;
      await tx.printJob.updateMany({
        where: {
          id: execution.job.id,
          merchantId: execution.job.merchantId,
          status: 'PRINTING',
          leaseVersion: execution.job.leaseVersion,
        },
        data: {
          status: 'SUCCEEDED',
          completedAt: now,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          retryBlocked: false,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    });
    try {
      await this.persistPrinterStatus(execution.job, 'ONLINE');
    } catch (error) {
      this.logger.warn(
        `Cloud printer status update failed provider=${providerForChannel(execution.job.printer.channelType)} job=${execution.job.id.toString()} code=${safeWorkerError(error)}`,
      );
    }
    this.logger.log(
      `Cloud task printed provider=${providerForChannel(execution.job.printer.channelType)} job=${execution.job.id.toString()}`,
    );
  }

  private async finishProviderCancelled(execution: PollableCloudExecution) {
    await this.finishPolledFailure(
      execution,
      'CANCELLED',
      PRINTING_ERROR_CODES.CLOUD_TASK_CANCELLED,
      '厂商已取消云打印任务',
      false,
    );
  }

  private async finishPolledUnknown(
    execution: PollableCloudExecution,
    message: string,
  ) {
    await this.finishPolledFailure(
      execution,
      'UNKNOWN',
      PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
      message,
      true,
    );
  }

  private async finishPolledFailure(
    execution: PollableCloudExecution,
    cloudStatus: 'UNKNOWN' | 'CANCELLED',
    code: string,
    message: string,
    retryBlocked: boolean,
  ) {
    const now = new Date();
    const safeMessage = sanitizePrintingError(message);
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.printAttempt.updateMany({
        where: {
          id: execution.attempt.id,
          jobId: execution.job.id,
          finishedAt: null,
          cloudStatus: { in: ['SUBMITTED', 'ACCEPTED'] },
        },
        data: {
          finishedAt: now,
          result: retryBlocked ? 'OUTCOME_UNKNOWN' : 'FAILED',
          cloudStatus,
          providerCheckedAt: now,
          providerCheckCount: { increment: 1 },
          errorCode: code,
          errorMessage: safeMessage,
        },
      });
      if (attempt.count !== 1) return;
      await tx.printJob.updateMany({
        where: {
          id: execution.job.id,
          merchantId: execution.job.merchantId,
          status: 'PRINTING',
          leaseVersion: execution.job.leaseVersion,
        },
        data: {
          status: 'FAILED',
          completedAt: now,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          retryBlocked,
          lastErrorCode: code,
          lastErrorMessage: safeMessage,
        },
      });
    });
  }

  private async recoverExpiredCloudSubmissions() {
    const now = new Date();
    const expired = await this.prisma.printJob.findMany({
      where: {
        status: 'PRINTING',
        leaseExpiresAt: { lte: now },
        printer: { channelType: { in: CLOUD_CHANNELS } },
        attempts: {
          some: { finishedAt: null, cloudStatus: 'SUBMITTING' },
        },
      },
      select: {
        id: true,
        merchantId: true,
        leaseVersion: true,
        attempts: {
          where: { finishedAt: null, cloudStatus: 'SUBMITTING' },
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
      take: this.maxBatch(),
    });
    let recovered = 0;
    for (const job of expired) {
      const attempt = job.attempts[0];
      if (!attempt) continue;
      const changed = await this.prisma.$transaction(async (tx) => {
        const updatedJob = await tx.printJob.updateMany({
          where: {
            id: job.id,
            merchantId: job.merchantId,
            status: 'PRINTING',
            leaseVersion: job.leaseVersion,
            leaseExpiresAt: { lte: now },
          },
          data: {
            status: 'FAILED',
            completedAt: now,
            claimedAt: null,
            claimedByTerminalId: null,
            leaseExpiresAt: null,
            leaseVersion: { increment: 1 },
            retryBlocked: true,
            lastErrorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
            lastErrorMessage: '云打印提交中断，厂商是否受理暂时无法确认',
          },
        });
        if (updatedJob.count !== 1) return 0;
        await tx.printAttempt.updateMany({
          where: { id: attempt.id, finishedAt: null, cloudStatus: 'SUBMITTING' },
          data: {
            finishedAt: now,
            result: 'OUTCOME_UNKNOWN',
            cloudStatus: 'UNKNOWN',
            errorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
            errorMessage: 'Worker 租约过期，禁止自动重复提交',
          },
        });
        return 1;
      });
      recovered += changed;
    }

    const unstarted = await this.prisma.printJob.updateMany({
      where: {
        status: 'CLAIMED',
        leaseExpiresAt: { lte: now },
        claimedByTerminalId: null,
        printer: { channelType: { in: CLOUD_CHANNELS } },
      },
      data: {
        status: 'PENDING',
        claimedAt: null,
        leaseExpiresAt: null,
        leaseVersion: { increment: 1 },
        lastErrorCode: PRINTING_ERROR_CODES.LEASE_EXPIRED,
        lastErrorMessage: '云打印领取租约过期，尚未提交，已恢复等待',
      },
    });
    return recovered + unstarted.count;
  }

  private async persistPrinterStatus(
    job: ClaimedCloudExecution['job'] | PollableCloudExecution['job'],
    status: 'ONLINE' | 'OFFLINE' | 'ERROR',
  ) {
    const existingCapabilities = isObject(job.printer.capabilities)
      ? job.printer.capabilities
      : {};
    await this.prisma.printer.updateMany({
      where: {
        id: job.printerId,
        merchantId: job.merchantId,
        channelType: { in: CLOUD_CHANNELS },
        deletedAt: null,
      },
      data: {
        status,
        capabilities: {
          ...existingCapabilities,
          cloudStatus: {
            provider: providerForChannel(job.printer.channelType),
            status,
          },
          cloudStatusUpdatedAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
  }

  private workerEnabled() {
    if (isApiShadowDiagnosticMode()) return false;
    return process.env.CLOUD_PRINT_WORKER_ENABLED?.trim().toLowerCase() === 'true';
  }

  private pollIntervalMs() {
    return boundedInteger(process.env.CLOUD_PRINT_POLL_INTERVAL_MS, 5_000, 1_000, 60_000);
  }

  private statusQueryIntervalMs() {
    return Math.max(5_000, this.pollIntervalMs());
  }

  private leaseTimeoutMs() {
    return boundedInteger(process.env.CLOUD_PRINT_LEASE_TIMEOUT_MS, 30_000, 10_000, 120_000);
  }

  private maxBatch() {
    return boundedInteger(process.env.CLOUD_PRINT_MAX_BATCH, 10, 1, 50);
  }

  private resultTimeoutMs() {
    return boundedInteger(
      process.env.CLOUD_PRINT_RESULT_TIMEOUT_MS,
      15 * 60_000,
      60_000,
      24 * 60 * 60_000,
    );
  }
}

export function providerForChannel(channel: CloudChannel): CloudProvider {
  return channel === 'CLOUD_FEIE' ? 'FEIE' : 'YILIAN';
}

export function adapterForProvider(provider: CloudProvider) {
  return provider === 'FEIE' ? CLOUD_ATTEMPT_ADAPTERS[0] : CLOUD_ATTEMPT_ADAPTERS[1];
}

function isCloudChannel(value: PrinterChannelType): value is CloudChannel {
  return value === 'CLOUD_FEIE' || value === 'CLOUD_YILIAN';
}

function deviceIdForPrinter(channel: CloudChannel, value: Prisma.JsonValue) {
  if (!isObject(value)) return null;
  const key = channel === 'CLOUD_FEIE' ? 'printerSn' : 'machineCode';
  const deviceId = value[key];
  return typeof deviceId === 'string' && deviceId.trim() ? deviceId.trim() : null;
}

function cloudProviderRequestId(jobId: bigint, attemptNo: number, contentHash: string) {
  const digest = createHash('sha256')
    .update(`cloud-v1:${jobId}:${attemptNo}:${contentHash}`)
    .digest('hex')
    .slice(0, 32);
  return `yq-${jobId.toString()}-${attemptNo}-${digest}`.slice(0, 64);
}

function asProviderError(error: unknown) {
  if (error instanceof CloudProviderError) return error;
  return new CloudProviderError(
    PRINTING_ERROR_CODES.UNKNOWN,
    error instanceof Error ? error.message : '云打印执行异常',
    { retryable: false },
  );
}

function safeWorkerError(error: unknown) {
  if (error instanceof CloudProviderError) return `${error.code}: ${error.message}`;
  return sanitizePrintingError(error instanceof Error ? error.message : String(error)) ??
    'unknown cloud worker error';
}

function retryDelay(attemptNo: number) {
  return Math.min(300_000, 5_000 * 2 ** Math.max(0, attemptNo - 1));
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
