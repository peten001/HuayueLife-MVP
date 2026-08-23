import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrinterChannelType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  containsPrintingCredentialMaterial,
  PRINTING_ERROR_CODES,
  PrintingErrorCode,
  sanitizePrintingError,
} from '../types/printing-errors';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { receiptSnapshotHash } from '../utils/snapshot-hash';
import { isReadyPrinter } from '../utils/printer-readiness';
import { PrintingSettingsService } from './printing-settings.service';
import { LanTerminalBindingsService } from './lan-terminal-bindings.service';
import {
  ANDROID_LAN_ESCPOS_ADAPTER,
  lanBindingMetadata,
} from '../types/lan-terminal-binding';

export interface StartPrintingInput {
  merchantId: bigint;
  terminalId: bigint | null;
  printerId?: bigint;
  jobId: bigint;
  leaseVersion: number;
  adapter: string;
  appVersion?: string;
  networkInfo?: Record<string, unknown>;
  contentHash?: string;
  localBindingId?: string;
  bindingVersion?: number;
}

export interface FinishPrintingInput {
  merchantId: bigint;
  terminalId: bigint | null;
  printerId?: bigint;
  jobId: bigint;
  attemptNo: number;
  leaseVersion: number;
  printerResponse?: string;
  contentHash?: string;
  actualPayloadSha256?: string;
  transport?: string;
  bytesWritten?: number;
  localBindingId?: string;
  bindingVersion?: number;
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
    private readonly lanBindings: LanTerminalBindingsService,
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
        job,
        input.printerId,
        input.localBindingId,
        input.bindingVersion,
      );
      const expectedHash = this.assertContentHash(job, input.contentHash);
      const expectedPayloadSha256 = job.renderedPayloadSha256;
      const expectedAdapter = this.expectedTerminalAdapter(
        job.printer.channelType,
      );
      this.assertTerminalRouteIdentity(
        job,
        input.terminalId,
        input.printerId,
        input.localBindingId,
        input.bindingVersion,
      );
      if (adapter !== expectedAdapter) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: '打印适配器与任务通道不匹配',
        });
      }
      if (job.status === 'PRINTING' && job.claimedByTerminalId === input.terminalId) {
        const existingAttempt = await tx.printAttempt.findFirst({
          where: {
            jobId: job.id,
            attemptNo: job.attemptCount,
            terminalId: input.terminalId,
            finishedAt: null,
            adapter: expectedAdapter,
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
          printer: { channelType: job.printer.channelType },
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
          adapter: expectedAdapter,
          appVersion: input.appVersion?.slice(0, 64),
          networkInfo,
          contentHash: expectedHash,
          expectedPayloadSha256,
          transport: expectedAdapter,
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
      const expectedPayloadSha256 = job.renderedPayloadSha256;
      this.assertPayloadHash(expectedPayloadSha256, input.actualPayloadSha256);
      this.assertCompletePayloadWrite(
        job,
        input.bytesWritten,
        input.actualPayloadSha256,
      );
      const expectedAdapter = this.expectedTerminalAdapter(
        job.printer.channelType,
      );
      const transport = normalizeTransport(input.transport) ?? expectedAdapter;
      this.assertTerminalRouteIdentity(
        job,
        input.terminalId,
        input.printerId,
        input.localBindingId,
        input.bindingVersion,
      );
      if (job.status === 'SUCCEEDED') {
        const completedAttempt = await tx.printAttempt.findFirst({
          where: {
            jobId: job.id,
            attemptNo: input.attemptNo,
            terminalId: input.terminalId,
            executorType: 'TERMINAL',
            adapter: expectedAdapter,
            result: 'SUCCEEDED',
          },
        });
        if (
          completedAttempt &&
          completedAttempt.printerResponse === sanitizePrintingError(input.printerResponse)
          && (input.contentHash === undefined || completedAttempt.contentHash === expectedHash)
          && (input.actualPayloadSha256 === undefined || completedAttempt.actualPayloadSha256 === input.actualPayloadSha256)
          && (input.transport === undefined || completedAttempt.transport === transport)
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
          printer: { channelType: job.printer.channelType },
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
          executorType: 'TERMINAL',
          adapter: expectedAdapter,
        },
        data: {
          finishedAt: now,
          result: 'SUCCEEDED',
          printerResponse: sanitizePrintingError(input.printerResponse),
          contentHash: expectedHash,
          expectedPayloadSha256,
          actualPayloadSha256: input.actualPayloadSha256,
          transport,
          bytesWritten: input.bytesWritten,
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
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
      const expectedPayloadSha256 = job.renderedPayloadSha256;
      this.assertPayloadHash(expectedPayloadSha256, input.actualPayloadSha256);
      const expectedAdapter = this.expectedTerminalAdapter(
        job.printer.channelType,
      );
      const transport = normalizeTransport(input.transport) ?? expectedAdapter;
      this.assertTerminalRouteIdentity(
        job,
        input.terminalId,
        input.printerId,
        input.localBindingId,
        input.bindingVersion,
      );
      const outcomeUnknown =
        input.errorCode === PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN;
      const expectedResult = outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED';
      const completedAttempt = await tx.printAttempt.findFirst({
        where: {
          jobId: job.id,
          attemptNo: input.attemptNo,
          terminalId: input.terminalId,
          finishedAt: { not: null },
          executorType: 'TERMINAL',
          adapter: expectedAdapter,
        },
      });
      if (completedAttempt) {
        if (
          completedAttempt.result === expectedResult &&
          completedAttempt.errorCode === input.errorCode &&
          completedAttempt.errorMessage === sanitizePrintingError(input.errorMessage) &&
          completedAttempt.printerResponse === sanitizePrintingError(input.printerResponse) &&
          (input.contentHash === undefined || completedAttempt.contentHash === expectedHash) &&
          (input.actualPayloadSha256 === undefined || completedAttempt.actualPayloadSha256 === input.actualPayloadSha256) &&
          (input.transport === undefined || completedAttempt.transport === transport) &&
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
          printer: { channelType: job.printer.channelType },
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
          executorType: 'TERMINAL',
          adapter: expectedAdapter,
        },
        data: {
          finishedAt: now,
          result: outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
          errorCode: input.errorCode,
          errorMessage: sanitizePrintingError(input.errorMessage),
          printerResponse: sanitizePrintingError(input.printerResponse),
          contentHash: expectedHash,
          expectedPayloadSha256,
          actualPayloadSha256: input.actualPayloadSha256,
          transport,
          bytesWritten: input.bytesWritten,
        },
      });
      if (attempt.count !== 1) this.stateConflict('当前打印尝试不存在或已完成');
      return tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async extendLease(
    merchantId: bigint,
    terminalId: bigint | null,
    jobId: bigint,
    expectedLeaseVersion: number,
    leaseMs = 30_000,
    localBindingId?: string,
    bindingVersion?: number,
    printerId?: bigint,
  ) {
    this.assertExecution();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    if (terminalId !== null) {
      await this.requireActiveTerminal(merchantId, terminalId);
    }
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, merchantId },
      include: {
        printer: {
          select: { id: true, channelType: true, capabilities: true },
        },
      },
    });
    if (!job) this.notFound();
    this.expectedTerminalAdapter(job.printer.channelType);
    this.assertTerminalRouteIdentity(
      job,
      terminalId,
      printerId,
      localBindingId,
      bindingVersion,
    );
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
        printer: { channelType: job.printer.channelType },
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

  private assertCompletePayloadWrite(
    job: { renderedPayloadByteLength: number | null },
    bytesWritten?: number,
    actualPayloadSha256?: string,
  ) {
    if (
      actualPayloadSha256 !== undefined &&
      job.renderedPayloadByteLength !== null &&
      bytesWritten !== job.renderedPayloadByteLength
    ) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.CONTENT_HASH_MISMATCH,
        message: '打印字节数与服务端最终 payload 不一致',
      });
    }
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
    const job = await client.printJob.findFirst({
      where: { id: jobId, merchantId },
      include: {
        printer: {
          select: {
            id: true,
            channelType: true,
            enabled: true,
            status: true,
            connectionConfig: true,
            capabilities: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!job) this.notFound();
    return job;
  }

  private async assertStartStillEnabled(
    client: Prisma.TransactionClient,
    merchantId: bigint,
    terminalId: bigint | null,
    job: {
      printerId: bigint;
      source: string;
      printer: {
        id: bigint;
        channelType: PrinterChannelType;
        enabled: boolean;
        status: string;
        connectionConfig: Prisma.JsonValue;
        capabilities: Prisma.JsonValue;
        deletedAt: Date | null;
      };
    },
    printerId?: bigint,
    localBindingId?: string,
    bindingVersion?: number,
  ) {
    await this.settings.assertMerchantPrintingEnabled(merchantId, client);
    if (job.printer.channelType === 'LOCAL_LAN_ESCPOS') {
      if (terminalId === null) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.LAN_BINDING_MISSING,
          message: 'LAN 打印任务缺少绑定终端',
        });
      }
      await this.lanBindings.requireClaimable(
        merchantId,
        job.printerId,
        terminalId,
        localBindingId,
        bindingVersion,
        job.source === 'TEST',
        client,
      );
      return;
    }
    if (terminalId === null) {
      const printer = await client.printer.findFirst({
        where: {
          id: job.printerId,
          merchantId,
          channelType: 'LOCAL_USB_ESCPOS',
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
      terminal.boundPrinterId !== job.printerId ||
      !terminal.boundPrinter ||
      terminal.boundPrinter.deletedAt ||
      terminal.boundPrinter.channelType !== 'LOCAL_USB_ESCPOS' ||
      !isReadyPrinter(terminal.boundPrinter)
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        message: '绑定的 USB 打印设备尚无明确可用证据',
      });
    }
  }

  private expectedTerminalAdapter(channelType: PrinterChannelType) {
    if (channelType === 'LOCAL_USB_ESCPOS') return 'ANDROID_USB_ESCPOS';
    if (channelType === 'LOCAL_LAN_ESCPOS') {
      return ANDROID_LAN_ESCPOS_ADAPTER;
    }
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
      message: '当前任务不支持 Android 终端执行',
    });
  }

  private assertTerminalRouteIdentity(
    job: {
      printerId: bigint;
      printer: {
        channelType: PrinterChannelType;
        capabilities: Prisma.JsonValue;
      };
    },
    terminalId: bigint | null,
    printerId: bigint | undefined,
    localBindingId: string | undefined,
    bindingVersion: number | undefined,
  ) {
    if (job.printer.channelType !== 'LOCAL_LAN_ESCPOS') {
      if (localBindingId !== undefined || bindingVersion !== undefined) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: 'USB 任务不接受 LAN Binding 标识',
        });
      }
      return;
    }
    const binding = lanBindingMetadata(job.printer.capabilities);
    if (
      terminalId === null ||
      printerId === undefined ||
      job.printerId !== printerId ||
      !localBindingId ||
      !binding ||
      binding.terminalId !== terminalId.toString() ||
      binding.localBindingId !== localBindingId ||
      !Number.isInteger(bindingVersion) ||
      binding.bindingVersion !== bindingVersion
    ) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '任务终端与 LAN Binding 不匹配',
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

  private assertPayloadHash(expected: string | null, received: string | undefined) {
    if (expected && received !== undefined && received !== expected) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.CONTENT_HASH_MISMATCH,
        message: '最终打印字节哈希不匹配，已拒绝执行或回报',
      });
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

const REPORTED_PRINT_TRANSPORTS = new Set([
  'ANDROID_USB_ESCPOS',
  'ANDROID_LAN_ESCPOS',
  'WINDOWS_RAW_SPOOLER',
  'WINDOWS_TCP_ESCPOS',
]);

function normalizeTransport(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!REPORTED_PRINT_TRANSPORTS.has(normalized)) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '打印传输类型无效',
    });
  }
  return normalized;
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
  if (
    typeof value === 'string' &&
    containsPrintingCredentialMaterial(value)
  ) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '网络诊断信息不允许包含敏感字段',
    });
  }
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
