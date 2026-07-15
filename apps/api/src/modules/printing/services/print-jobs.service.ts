import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrintJobSource,
  PrintJobStatus,
  PrintTriggerEvent,
  Prisma,
  ReceiptType,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { ListPrintJobsQueryDto } from '../dto/print-job.dto';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { ReceiptDocument } from '../types/receipt-document';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { ReceiptSnapshotService } from './receipt-snapshot.service';

type DbClient = PrismaService | Prisma.TransactionClient;

const RETRYABLE_MANUAL_ERROR_CODES: string[] = [
  PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
  PRINTING_ERROR_CODES.PRINTER_OFFLINE,
  PRINTING_ERROR_CODES.LEASE_EXPIRED,
  PRINTING_ERROR_CODES.UNKNOWN,
];

export interface CreateAutomaticJobInput {
  merchantId: bigint;
  ruleId: bigint;
  eventKey: string;
  orderId?: bigint;
  tableSessionId?: bigint;
}

export interface CreateManualReprintJobInput {
  merchantId: bigint;
  originalJobId: bigint;
  createdByStaffId: bigint;
  requestId?: string;
  reason?: string;
  printerId?: bigint;
}

export interface CreateTestJobInput {
  merchantId: bigint;
  printerId: bigint;
  receiptTemplateId?: bigint;
  createdByStaffId?: bigint;
  requestId?: string;
  document: ReceiptDocument;
}

@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly snapshots: ReceiptSnapshotService,
    private readonly audit: PrintingAuditService,
  ) {}

  async list(merchantId: bigint, query: ListPrintJobsQueryDto) {
    this.flags.assertTaskCenterEnabled();
    const jobs = await this.prisma.printJob.findMany({
      where: {
        merchantId,
        status: query.status as PrintJobStatus | undefined,
        source: query.source as PrintJobSource | undefined,
        printerId: query.printerId ? BigInt(query.printerId) : undefined,
        orderId: query.orderId ? BigInt(query.orderId) : undefined,
      },
      select: {
        id: true,
        orderId: true,
        tableSessionId: true,
        receiptType: true,
        triggerEvent: true,
        source: true,
        status: true,
        priority: true,
        requestGroupId: true,
        copyIndex: true,
        copyCount: true,
        attemptCount: true,
        maxAttempts: true,
        retryBlocked: true,
        availableAt: true,
        completedAt: true,
        cancelledAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        createdAt: true,
        updatedAt: true,
        printer: { select: { id: true, name: true, channelType: true } },
        order: { select: { orderNo: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 100,
    });
    return jobs.map((job) => ({
      ...job,
      lastErrorMessage: sanitizePrintingError(job.lastErrorMessage),
    }));
  }

  async get(merchantId: bigint, id: bigint) {
    this.flags.assertTaskCenterEnabled();
    const job = await this.prisma.printJob.findFirst({
      where: { id, merchantId },
      include: {
        printer: { select: { id: true, name: true, channelType: true, enabled: true } },
        order: { select: { orderNo: true } },
        receiptTemplate: {
          select: { id: true, name: true, version: true, receiptType: true },
        },
        claimedBy: { select: { id: true, name: true, status: true } },
        attempts: {
          orderBy: { attemptNo: 'asc' },
          select: {
            id: true,
            attemptNo: true,
            startedAt: true,
            finishedAt: true,
            result: true,
            errorCode: true,
            errorMessage: true,
          },
        },
      },
    });
    if (!job) this.notFound();
    return {
      ...job,
      lastErrorMessage: sanitizePrintingError(job.lastErrorMessage),
      attempts: job.attempts.map((attempt) => ({
        ...attempt,
        errorMessage: sanitizePrintingError(attempt.errorMessage),
      })),
    };
  }

  async createAutomaticJob(input: CreateAutomaticJobInput) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertAutomaticCreationEnabled();
    const rule = await this.prisma.printRule.findFirst({
      where: {
        id: input.ruleId,
        merchantId: input.merchantId,
        enabled: true,
        autoPrint: true,
      },
    });
    if (!rule) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '自动打印规则不存在或未启用',
      });
    }
    if (!input.eventKey.trim() || input.eventKey.length > 64) {
      this.referenceError('自动打印事件标识不能为空且不能超过 64 个字符');
    }
    const snapshot = await this.createSnapshot(
      input.merchantId,
      rule.receiptType,
      input.orderId,
      input.tableSessionId,
    );
    this.assertSnapshotMerchant(input.merchantId, snapshot);
    const requestGroupId = this.requestGroupId({
      merchantId: input.merchantId,
      eventKey: input.eventKey,
      printerId: rule.printerId,
      receiptType: rule.receiptType,
      triggerEvent: rule.triggerEvent,
      ruleId: rule.id,
    });
    const copyCount = Number.isInteger(rule.copies)
      ? Math.max(1, Math.min(3, rule.copies))
      : 1;
    const dedupeKeys = Array.from({ length: copyCount }, (_, index) =>
      this.automaticDedupeKey({
        merchantId: input.merchantId,
        eventKey: input.eventKey,
        printerId: rule.printerId,
        receiptType: rule.receiptType,
        triggerEvent: rule.triggerEvent,
        ruleId: rule.id,
        copyIndex: index + 1,
      }),
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const jobs = [];
        for (let index = 0; index < copyCount; index += 1) {
          jobs.push(
            await this.createJob(
              {
                merchantId: input.merchantId,
                orderId: input.orderId,
                tableSessionId: input.tableSessionId,
                printerId: rule.printerId,
                printRuleId: rule.id,
                ruleVersion: rule.updatedAt.toISOString(),
                requestGroupId,
                copyIndex: index + 1,
                copyCount,
                receiptTemplateId: rule.receiptTemplateId ?? undefined,
                receiptType: rule.receiptType,
                triggerEvent: rule.triggerEvent,
                source: 'AUTOMATIC',
                priority: rule.priority,
                dedupeKey: dedupeKeys[index],
                snapshot,
              },
              tx,
            ),
          );
        }
        return jobs;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.printJob.findMany({
        where: { merchantId: input.merchantId, dedupeKey: { in: dedupeKeys } },
        orderBy: { copyIndex: 'asc' },
      });
      if (existing.length !== dedupeKeys.length) throw error;
      return existing;
    }
  }

  async createManualReprintJob(input: CreateManualReprintJobInput) {
    this.flags.assertTaskCenterEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.requireOwnedStaff(tx, input.merchantId, input.createdByStaffId);
      const original = await tx.printJob.findFirst({
        where: { id: input.originalJobId, merchantId: input.merchantId },
      });
      if (!original) this.notFound();
      const snapshot = this.snapshots.cloneAndValidate(
        original.receiptSnapshot as unknown as ReceiptDocument,
      );
      this.assertSnapshotMerchant(input.merchantId, snapshot);
      const created = await this.createJob(
        {
          merchantId: input.merchantId,
          orderId: original.orderId ?? undefined,
          tableSessionId: original.tableSessionId ?? undefined,
          printerId: input.printerId ?? original.printerId,
          printRuleId: original.printRuleId ?? undefined,
          ruleVersion: original.ruleVersion ?? undefined,
          requestGroupId: randomUUID(),
          copyIndex: 1,
          copyCount: 1,
          receiptTemplateId: original.receiptTemplateId ?? undefined,
          receiptType: original.receiptType,
          triggerEvent: 'MANUAL',
          source: 'MANUAL_REPRINT',
          priority: original.priority,
          snapshot,
          createdByStaffId: input.createdByStaffId,
          allowHistoricalTemplate: true,
        },
        tx,
      );
      await this.audit.record(
        {
          merchantId: input.merchantId,
          actorStaffId: input.createdByStaffId,
          action: 'PRINT_JOB_MANUAL_REPRINT_CREATED',
          resourceType: 'PrintJob',
          resourceId: created.id,
          afterData: {
            sourceJobId: original.id.toString(),
            printerId: created.printerId.toString(),
          },
          reason: input.reason,
          requestId: input.requestId,
        },
        tx,
      );
      return created;
    });
  }

  async createTestJob(input: CreateTestJobInput) {
    this.flags.assertTaskCenterEnabled();
    const snapshot = this.snapshots.cloneAndValidate(input.document);
    this.assertSnapshotMerchant(input.merchantId, snapshot);
    return this.prisma.$transaction(async (tx) => {
      if (input.createdByStaffId) {
        await this.requireOwnedStaff(tx, input.merchantId, input.createdByStaffId);
      }
      const created = await this.createJob(
        {
          merchantId: input.merchantId,
          printerId: input.printerId,
          requestGroupId: randomUUID(),
          copyIndex: 1,
          copyCount: 1,
          receiptTemplateId: input.receiptTemplateId,
          receiptType: input.document.receiptType,
          triggerEvent: 'MANUAL',
          source: 'TEST',
          priority: 100,
          snapshot,
          createdByStaffId: input.createdByStaffId,
        },
        tx,
      );
      await this.audit.record(
        {
          merchantId: input.merchantId,
          actorStaffId: input.createdByStaffId,
          action: 'PRINT_JOB_TEST_CREATED',
          resourceType: 'PrintJob',
          resourceId: created.id,
          afterData: { printerId: created.printerId.toString() },
          requestId: input.requestId,
        },
        tx,
      );
      return created;
    });
  }

  async cancel(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    reason?: string,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.requireOwnedStaff(this.prisma, merchantId, actorStaffId);
    const job = await this.requireOwned(merchantId, id);
    if (!['PENDING', 'RETRY_WAIT'].includes(job.status)) {
      this.stateConflict('只有待处理或等待重试的任务可以取消');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.printJob.updateMany({
        where: { id, merchantId, status: { in: ['PENDING', 'RETRY_WAIT'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (changed.count !== 1) this.stateConflict('任务状态已变化，请刷新后重试');
      const next = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINT_JOB_CANCELLED',
          resourceType: 'PrintJob',
          resourceId: id,
          beforeData: { status: job.status },
          afterData: { status: next.status },
          reason,
          requestId,
        },
        tx,
      );
      return next;
    });
    return updated;
  }

  async retry(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    reason?: string,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.requireOwnedStaff(this.prisma, merchantId, actorStaffId);
    const job = await this.requireOwned(merchantId, id);
    if (!['FAILED', 'RETRY_WAIT'].includes(job.status)) {
      this.stateConflict('只有失败或等待重试的任务可以人工重试');
    }
    if (job.retryBlocked || job.lastErrorCode === PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN) {
      this.stateConflict('任务可能已经出纸，不能重试原任务；请人工确认后创建补打任务');
    }
    if (job.attemptCount >= job.maxAttempts) {
      this.stateConflict('任务已达到最大尝试次数，不能继续重试原任务');
    }
    if (
      job.status === 'FAILED' &&
      job.lastErrorCode &&
      !RETRYABLE_MANUAL_ERROR_CODES.includes(job.lastErrorCode)
    ) {
      this.stateConflict('该错误不可安全重试，请修复配置后创建新的补打任务');
    }
    await this.requireEnabledPrinter(merchantId, job.printerId);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.printJob.updateMany({
        where: { id, merchantId, status: { in: ['FAILED', 'RETRY_WAIT'] } },
        data: {
          status: 'RETRY_WAIT',
          availableAt: new Date(),
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          completedAt: null,
          retryBlocked: false,
        },
      });
      if (changed.count !== 1) this.stateConflict('任务状态已变化，请刷新后重试');
      const next = await tx.printJob.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINT_JOB_RETRIED',
          resourceType: 'PrintJob',
          resourceId: id,
          beforeData: { status: job.status, attemptCount: job.attemptCount },
          afterData: { status: next.status, maxAttempts: next.maxAttempts },
          reason,
          requestId,
        },
        tx,
      );
      return next;
    });
  }

  async claimNextJob(
    merchantId: bigint,
    terminalId: bigint,
    leaseMs = 30_000,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id: terminalId, merchantId, status: 'ACTIVE', revokedAt: null },
    });
    if (!terminal) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '终端未启用或不属于当前商家',
      });
    }

    await this.releaseAvailableRetries(new Date(), merchantId);

    for (let round = 0; round < 3; round += 1) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const candidate = await tx.printJob.findFirst({
          where: {
            merchantId,
            status: 'PENDING',
            availableAt: { lte: now },
            retryBlocked: false,
            printer: { merchantId, enabled: true, deletedAt: null },
          },
          orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }, { id: 'asc' }],
        });
        if (!candidate) return null;
        const leaseExpiresAt = new Date(now.getTime() + Math.max(5_000, leaseMs));
        const changed = await tx.printJob.updateMany({
          where: {
            id: candidate.id,
            merchantId,
            status: 'PENDING',
            leaseVersion: candidate.leaseVersion,
          },
          data: {
            status: 'CLAIMED',
            claimedAt: now,
            claimedByTerminalId: terminalId,
            leaseExpiresAt,
            leaseVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) return null;
        return tx.printJob.findUnique({ where: { id: candidate.id } });
      });
      if (claimed) return claimed;
    }
    return null;
  }

  async releaseExpiredLeases(now = new Date()) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.printJob.updateMany({
        where: { status: 'CLAIMED', leaseExpiresAt: { lte: now } },
        data: {
          status: 'PENDING',
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          lastErrorCode: PRINTING_ERROR_CODES.LEASE_EXPIRED,
          lastErrorMessage: '任务领取租约已过期，已恢复等待领取',
        },
      });
      const printingJobs = await tx.printJob.findMany({
        where: { status: 'PRINTING', leaseExpiresAt: { lte: now } },
        select: { id: true, attemptCount: true, maxAttempts: true },
      });
      let printing = 0;
      for (const job of printingJobs) {
        const changed = await tx.printJob.updateMany({
          where: { id: job.id, status: 'PRINTING', leaseExpiresAt: { lte: now } },
          data: {
            status: 'FAILED',
            claimedAt: null,
            claimedByTerminalId: null,
            leaseExpiresAt: null,
            leaseVersion: { increment: 1 },
            completedAt: now,
            retryBlocked: true,
            lastErrorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
            lastErrorMessage: '打印中租约过期，实际出纸结果未知',
          },
        });
        if (changed.count === 1) {
          printing += 1;
          await tx.printAttempt.updateMany({
            where: { jobId: job.id, attemptNo: job.attemptCount, finishedAt: null },
            data: {
              finishedAt: now,
              result: 'OUTCOME_UNKNOWN',
              errorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
              errorMessage: '回报丢失，实际出纸结果未知',
            },
          });
        }
      }
      return { claimed: claimed.count, printing };
    });
  }

  async releaseAvailableRetries(now = new Date(), merchantId?: bigint) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.printJob.findMany({
        where: {
          merchantId,
          status: 'RETRY_WAIT',
          availableAt: { lte: now },
          retryBlocked: false,
        },
        select: {
          id: true,
          merchantId: true,
          attemptCount: true,
          maxAttempts: true,
          leaseVersion: true,
        },
        take: 100,
      });
      let released = 0;
      for (const job of candidates) {
        if (job.attemptCount >= job.maxAttempts) continue;
        const changed = await tx.printJob.updateMany({
          where: {
            id: job.id,
            merchantId: job.merchantId,
            status: 'RETRY_WAIT',
            availableAt: { lte: now },
            retryBlocked: false,
            leaseVersion: job.leaseVersion,
          },
          data: { status: 'PENDING', leaseVersion: { increment: 1 } },
        });
        released += changed.count;
      }
      return released;
    });
  }

  private async createJob(input: {
    merchantId: bigint;
    orderId?: bigint;
    tableSessionId?: bigint;
    printerId: bigint;
    printRuleId?: bigint;
    ruleVersion?: string;
    requestGroupId?: string;
    copyIndex?: number;
    copyCount?: number;
    receiptTemplateId?: bigint;
    receiptType: ReceiptType;
    triggerEvent: PrintTriggerEvent;
    source: PrintJobSource;
    priority: number;
    dedupeKey?: string;
    snapshot: ReceiptDocument;
    createdByStaffId?: bigint;
    allowHistoricalTemplate?: boolean;
  }, client: DbClient = this.prisma) {
    const { printer, template } = await this.validateJobReferences(
      input.merchantId,
      input.printerId,
      input.receiptTemplateId,
      input.receiptType,
      input.allowHistoricalTemplate ?? false,
      client,
    );
    if (input.orderId) {
      const order = await client.order.findFirst({
        where: { id: input.orderId, merchantId: input.merchantId },
        select: { id: true },
      });
      if (!order) this.referenceError('订单不存在或不属于当前商家');
    }
    if (input.tableSessionId) {
      const session = await client.tableSession.findFirst({
        where: { id: input.tableSessionId, merchantId: input.merchantId },
        select: { id: true },
      });
      if (!session) this.referenceError('桌台账单不存在或不属于当前商家');
    }
    return client.printJob.create({
      data: {
        merchantId: input.merchantId,
        orderId: input.orderId,
        tableSessionId: input.tableSessionId,
        printerId: printer.id,
        printRuleId: input.printRuleId,
        ruleVersion: input.ruleVersion,
        requestGroupId: input.requestGroupId,
        copyIndex: input.copyIndex ?? 1,
        copyCount: input.copyCount ?? 1,
        receiptTemplateId: template?.id,
        receiptTemplateVersion: template?.version,
        receiptType: input.receiptType,
        triggerEvent: input.triggerEvent,
        source: input.source,
        status: 'PENDING',
        priority: input.priority,
        dedupeKey: input.dedupeKey,
        receiptSnapshot: input.snapshot as unknown as Prisma.InputJsonValue,
        createdByStaffId: input.createdByStaffId,
      },
    });
  }

  private async createSnapshot(
    merchantId: bigint,
    receiptType: ReceiptType,
    orderId?: bigint,
    tableSessionId?: bigint,
  ) {
    if (receiptType === 'ORDER_CUSTOMER' && orderId) {
      return this.snapshots.fromOrder(merchantId, orderId);
    }
    if (receiptType === 'TABLE_BILL' && tableSessionId) {
      return this.snapshots.fromTableSession(merchantId, tableSessionId);
    }
    this.referenceError('小票类型与订单或桌台账单参数不匹配');
  }

  private async validateJobReferences(
    merchantId: bigint,
    printerId: bigint,
    templateId: bigint | undefined,
    receiptType: ReceiptType,
    allowHistoricalTemplate: boolean,
    client: DbClient = this.prisma,
  ) {
    const [printer, template] = await Promise.all([
      this.requireEnabledPrinter(merchantId, printerId, client),
      templateId
        ? client.receiptTemplate.findFirst({
            where: {
              id: templateId,
              enabled: allowHistoricalTemplate ? undefined : true,
              OR: [{ merchantId }, { merchantId: null }],
            },
          })
        : null,
    ]);
    if (templateId && !template) this.referenceError('小票模板不存在或未启用');
    if (template && template.receiptType !== receiptType) {
      this.referenceError('任务小票类型与模板不一致');
    }
    if (template && template.paperWidth !== printer.paperWidth) {
      this.referenceError('任务打印机纸宽与模板不一致');
    }
    return { printer, template };
  }

  private async requireEnabledPrinter(
    merchantId: bigint,
    printerId: bigint,
    client: DbClient = this.prisma,
  ) {
    const printer = await client.printer.findFirst({
      where: { id: printerId, merchantId, deletedAt: null },
    });
    if (!printer) this.referenceError('打印机不存在或不属于当前商家');
    if (!printer.enabled) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_DISABLED,
        message: '打印机已停用，不能创建或重试任务',
      });
    }
    return printer;
  }

  private async requireOwned(merchantId: bigint, id: bigint) {
    const job = await this.prisma.printJob.findFirst({ where: { id, merchantId } });
    if (!job) this.notFound();
    return job;
  }

  private async requireOwnedStaff(
    client: DbClient,
    merchantId: bigint,
    staffId: bigint,
  ) {
    const staff = await client.merchantStaff.findFirst({
      where: { id: staffId, merchantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!staff) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '操作员工不属于当前商家或已停用',
      });
    }
  }

  private assertSnapshotMerchant(merchantId: bigint, snapshot: ReceiptDocument) {
    if (snapshot.merchant.id !== merchantId.toString()) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '小票快照商家作用域不匹配',
      });
    }
  }

  private automaticDedupeKey(input: {
    merchantId: bigint;
    eventKey: string;
    printerId: bigint;
    receiptType: ReceiptType;
    triggerEvent: PrintTriggerEvent;
    ruleId: bigint;
    copyIndex: number;
  }) {
    const raw = [
      'v1',
      input.merchantId,
      input.eventKey,
      input.printerId,
      input.receiptType,
      input.triggerEvent,
      input.ruleId,
      input.copyIndex,
    ].join(':');
    return `auto:${createHash('sha256').update(raw).digest('hex')}`;
  }

  private requestGroupId(input: {
    merchantId: bigint;
    eventKey: string;
    printerId: bigint;
    receiptType: ReceiptType;
    triggerEvent: PrintTriggerEvent;
    ruleId: bigint;
  }) {
    return createHash('sha256')
      .update(
        [
          'group-v1',
          input.merchantId,
          input.eventKey,
          input.printerId,
          input.receiptType,
          input.triggerEvent,
          input.ruleId,
        ].join(':'),
      )
      .digest('hex');
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '打印任务不存在',
    });
  }

  private referenceError(message: string): never {
    throw new BadRequestException({ code: PRINTING_ERROR_CODES.CONFIG_INVALID, message });
  }

  private stateConflict(message: string): never {
    throw new ConflictException({ code: PRINTING_ERROR_CODES.STATE_CONFLICT, message });
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
