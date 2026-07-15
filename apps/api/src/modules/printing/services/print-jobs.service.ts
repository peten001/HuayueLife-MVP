import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PrintJobSource,
  PrintJobStatus,
  PrintTriggerEvent,
  OrderType,
  Prisma,
  ReceiptType,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { ListPrintJobsQueryDto } from '../dto/print-job.dto';
import { ReportTerminalPrinterStatusDto } from '../dto/terminal-connector.dto';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { ReceiptDocument } from '../types/receipt-document';
import { receiptSnapshotHash } from '../utils/snapshot-hash';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';
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

export interface EnqueueAutomaticTriggerInput {
  merchantId: bigint;
  orderId: bigint;
  orderStatusLogId: bigint;
  orderType: OrderType;
  status: 'ACCEPTED' | 'COMPLETED';
}

interface AutomaticRuleSnapshot {
  id: bigint;
  printerId: bigint;
  receiptTemplateId: bigint | null;
  receiptType: ReceiptType;
  triggerEvent: PrintTriggerEvent;
  copies: number;
  priority: number;
  ruleVersion: string;
}

export interface CreateManualReprintJobInput {
  merchantId: bigint;
  originalJobId: bigint;
  createdByStaffId: bigint;
  requestId?: string;
  reason?: string;
  printerId?: bigint;
  requestKey: string;
}

export interface CreateManualPrintJobInput {
  merchantId: bigint;
  createdByStaffId: bigint;
  requestId?: string;
  requestKey: string;
  printerId: bigint;
  orderId?: bigint;
  tableSessionId?: bigint;
  receiptType: ReceiptType;
}

export interface CreateTestJobInput {
  merchantId: bigint;
  printerId: bigint;
  receiptTemplateId?: bigint;
  createdByStaffId?: bigint;
  requestId?: string;
  requestKey: string;
  document: ReceiptDocument;
}

@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly snapshots: ReceiptSnapshotService,
    private readonly audit: PrintingAuditService,
    private readonly settings: PrintingSettingsService,
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
        tableSessionId: query.tableSessionId
          ? BigInt(query.tableSessionId)
          : undefined,
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

  async merchantConnectorConfig(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const [settings, printers] = await Promise.all([
      this.settings.get(merchantId),
      this.prisma.printer.findMany({
        where: {
          merchantId,
          deletedAt: null,
          channelType: 'LOCAL_USB_ESCPOS',
        },
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
        orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const flags = settings.featureFlags;
    const boundPrinter =
      printers.find((printer) => printer.enabled) ?? printers[0] ?? null;
    return {
      taskCenterEnabled: flags.taskCenterEnabled,
      executionEnabled: flags.executionEnabled,
      automaticCreationEnabled: flags.automaticCreationEnabled,
      legacyPrintingEnabled: flags.legacyPrintingEnabled,
      merchantPrintingEnabled: settings.printingEnabled,
      pollIntervalSeconds: 7,
      automaticPrintingEnabled: flags.automaticCreationEnabled,
      printerEnabled: boundPrinter?.enabled ?? false,
      boundPrinter,
      printers,
      commands: { resetUsb: null },
    };
  }

  async createAutomaticJob(input: CreateAutomaticJobInput) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertAutomaticCreationEnabled();
    await this.settings.assertMerchantEnabled(input.merchantId);
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
    this.assertAutomaticEventKey(input.eventKey);
    return this.createAutomaticJobsFromRuleSnapshot({
      merchantId: input.merchantId,
      orderId: input.orderId,
      tableSessionId: input.tableSessionId,
      eventKey: input.eventKey,
      rule: {
        id: rule.id,
        printerId: rule.printerId,
        receiptTemplateId: rule.receiptTemplateId,
        receiptType: rule.receiptType,
        triggerEvent: rule.triggerEvent,
        copies: rule.copies,
        priority: rule.priority,
        ruleVersion: rule.updatedAt.toISOString(),
      },
    });
  }

  /**
   * Records automatic-print intent inside the caller's order transition
   * transaction. No row is created while any global, merchant, rule or printer
   * gate is disabled. The event/routing snapshot survives later order status
   * changes and is processed idempotently after commit.
   */
  async enqueueAutomaticTriggersForOrderTransition(
    tx: Prisma.TransactionClient,
    input: EnqueueAutomaticTriggerInput,
  ) {
    if (!this.automaticTriggeringEnabled()) return [];
    const merchant = await tx.merchant.findUnique({
      where: { id: input.merchantId },
      select: { status: true, printingEnabled: true },
    });
    if (merchant?.status !== 'ACTIVE' || !merchant.printingEnabled) return [];
    const triggerEvent: PrintTriggerEvent =
      input.status === 'ACCEPTED' ? 'ORDER_ACCEPTED' : 'ORDER_COMPLETED';
    const rules = await tx.printRule.findMany({
      where: {
        merchantId: input.merchantId,
        enabled: true,
        autoPrint: true,
        triggerEvent,
        receiptType: 'ORDER_CUSTOMER',
        OR: [{ orderType: input.orderType }, { orderType: null }],
        printer: {
          enabled: true,
          deletedAt: null,
          channelType: 'LOCAL_USB_ESCPOS',
        },
      },
      select: {
        id: true,
        printerId: true,
        receiptTemplateId: true,
        receiptType: true,
        triggerEvent: true,
        copies: true,
        priority: true,
        updatedAt: true,
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    if (rules.length === 0) return [];
    const records = rules.map((rule) => ({
      merchantId: input.merchantId,
      orderId: input.orderId,
      orderStatusLogId: input.orderStatusLogId,
      printRuleId: rule.id,
      printerId: rule.printerId,
      receiptTemplateId: rule.receiptTemplateId,
      eventKey: this.outboxEventKey(
        input.merchantId,
        input.orderStatusLogId,
        triggerEvent,
        rule.id,
        rule.updatedAt.toISOString(),
      ),
      triggerEvent,
      ruleVersion: rule.updatedAt.toISOString(),
      receiptType: rule.receiptType,
      copies: Math.max(1, Math.min(3, rule.copies)),
      priority: rule.priority,
    }));
    await tx.printTriggerOutbox.createMany({ data: records, skipDuplicates: true });
    return tx.printTriggerOutbox.findMany({
      where: { eventKey: { in: records.map((record) => record.eventKey) } },
      select: { id: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }

  async processAutomaticTriggerIds(ids: bigint[]) {
    if (!this.automaticTriggeringEnabled() || ids.length === 0) return [];
    const results = [];
    for (const id of ids) results.push(await this.processAutomaticTrigger(id));
    return results;
  }

  async processPendingAutomaticTriggers(merchantId: bigint, limit = 20) {
    if (!this.automaticTriggeringEnabled()) return [];
    const now = new Date();
    const candidates = await this.prisma.printTriggerOutbox.findMany({
      where: {
        merchantId,
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      select: { id: true },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: Math.min(100, Math.max(1, limit)),
    });
    return this.processAutomaticTriggerIds(candidates.map(({ id }) => id));
  }

  private async processAutomaticTrigger(id: bigint) {
    const now = new Date();
    const candidate = await this.prisma.printTriggerOutbox.findFirst({
      where: {
        id,
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
    });
    if (!candidate) return { id, outcome: 'NOT_DUE' as const };
    const leaseExpiresAt = new Date(now.getTime() + 30_000);
    const claimed = await this.prisma.printTriggerOutbox.updateMany({
      where: {
        id,
        leaseVersion: candidate.leaseVersion,
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        claimedAt: now,
        leaseExpiresAt,
        leaseVersion: { increment: 1 },
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return { id, outcome: 'CONTENDED' as const };
    const trigger = await this.prisma.printTriggerOutbox.findUniqueOrThrow({
      where: { id },
    });
    try {
      await this.settings.assertMerchantEnabled(trigger.merchantId);
      await this.createAutomaticJobsFromRuleSnapshot({
        merchantId: trigger.merchantId,
        orderId: trigger.orderId,
        eventKey: trigger.eventKey,
        rule: {
          id: trigger.printRuleId,
          printerId: trigger.printerId,
          receiptTemplateId: trigger.receiptTemplateId,
          receiptType: trigger.receiptType,
          triggerEvent: trigger.triggerEvent,
          copies: trigger.copies,
          priority: trigger.priority,
          ruleVersion: trigger.ruleVersion,
        },
      });
      const processed = await this.prisma.printTriggerOutbox.updateMany({
        where: { id, status: 'PROCESSING', leaseVersion: trigger.leaseVersion },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return {
        id,
        outcome: processed.count === 1 ? ('PROCESSED' as const) : ('CONTENDED' as const),
      };
    } catch (error) {
      const failedPermanently = trigger.attemptCount >= trigger.maxAttempts;
      await this.prisma.printTriggerOutbox.updateMany({
        where: { id, status: 'PROCESSING', leaseVersion: trigger.leaseVersion },
        data: {
          status: failedPermanently ? 'FAILED' : 'PENDING',
          availableAt: failedPermanently
            ? undefined
            : new Date(Date.now() + outboxRetryDelay(trigger.attemptCount)),
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode(error),
          lastErrorMessage: '自动打印触发事件处理失败；等待安全重试',
        },
      });
      this.logger.warn(
        `Automatic print outbox processing failed id=${id} attempt=${trigger.attemptCount} code=${errorCode(error)}`,
      );
      return { id, outcome: failedPermanently ? ('FAILED' as const) : ('RETRY' as const) };
    }
  }

  private async createAutomaticJobsFromRuleSnapshot(input: {
    merchantId: bigint;
    orderId?: bigint;
    tableSessionId?: bigint;
    eventKey: string;
    rule: AutomaticRuleSnapshot;
  }) {
    this.assertAutomaticEventKey(input.eventKey);
    const rule = input.rule;
    const requestGroupId = this.requestGroupId({
      merchantId: input.merchantId,
      eventKey: input.eventKey,
      printerId: rule.printerId,
      receiptType: rule.receiptType,
      triggerEvent: rule.triggerEvent,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
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
        ruleVersion: rule.ruleVersion,
        copyIndex: index + 1,
      }),
    );
    const alreadyCreated = await this.prisma.printJob.findMany({
      where: { merchantId: input.merchantId, dedupeKey: { in: dedupeKeys } },
      orderBy: { copyIndex: 'asc' },
    });
    if (alreadyCreated.length === dedupeKeys.length) return alreadyCreated;
    const snapshot = await this.createSnapshot(
      input.merchantId,
      rule.receiptType,
      input.orderId,
      input.tableSessionId,
    );
    this.assertSnapshotMerchant(input.merchantId, snapshot);
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
                ruleVersion: rule.ruleVersion,
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

  async createManualPrintJob(input: CreateManualPrintJobInput) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantEnabled(input.merchantId);
    await this.requireOwnedStaff(
      this.prisma,
      input.merchantId,
      input.createdByStaffId,
    );
    const snapshot = await this.createSnapshot(
      input.merchantId,
      input.receiptType,
      input.orderId,
      input.tableSessionId,
    );
    const dedupeKey = this.manualDedupeKey(
      input.merchantId,
      input.createdByStaffId,
      `print:${input.receiptType}:${input.orderId ?? input.tableSessionId}:${input.printerId}`,
      input.requestKey,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await this.createJob(
          {
            merchantId: input.merchantId,
            orderId: input.orderId,
            tableSessionId: input.tableSessionId,
            printerId: input.printerId,
            requestGroupId: randomUUID(),
            copyIndex: 1,
            copyCount: 1,
            receiptType: input.receiptType,
            triggerEvent: 'MANUAL',
            source: 'MANUAL',
            priority: 50,
            dedupeKey,
            snapshot,
            createdByStaffId: input.createdByStaffId,
          },
          tx,
        );
        await this.audit.record(
          {
            merchantId: input.merchantId,
            actorStaffId: input.createdByStaffId,
            action: 'PRINT_JOB_MANUAL_CREATED',
            resourceType: 'PrintJob',
            resourceId: created.id,
            afterData: {
              printerId: created.printerId.toString(),
              receiptType: created.receiptType,
            },
            requestId: input.requestId,
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.printJob.findUnique({ where: { dedupeKey } });
      if (!existing || existing.merchantId !== input.merchantId) throw error;
      return existing;
    }
  }

  async createManualReprintJob(input: CreateManualReprintJobInput) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantEnabled(input.merchantId);
    const dedupeKey = this.manualDedupeKey(
      input.merchantId,
      input.createdByStaffId,
      `reprint:${input.originalJobId}:${input.printerId ?? 'original-printer'}`,
      input.requestKey,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
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
            dedupeKey,
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
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.printJob.findUnique({ where: { dedupeKey } });
      if (!existing || existing.merchantId !== input.merchantId) throw error;
      return existing;
    }
  }

  async createTestJob(input: CreateTestJobInput) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantEnabled(input.merchantId);
    const snapshot = this.snapshots.cloneAndValidate(input.document);
    this.assertSnapshotMerchant(input.merchantId, snapshot);
    const dedupeKey = this.manualDedupeKey(
      input.merchantId,
      input.createdByStaffId ?? 0n,
      `test:${input.printerId}`,
      input.requestKey,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
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
            dedupeKey,
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
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.printJob.findUnique({ where: { dedupeKey } });
      if (!existing || existing.merchantId !== input.merchantId) throw error;
      return existing;
    }
  }

  async createSafeUsbTestJob(
    merchantId: bigint,
    printerId: bigint,
    createdByStaffId: bigint,
    requestId?: string,
    requestKey: string = randomUUID(),
  ) {
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: printerId,
        merchantId,
        channelType: 'LOCAL_USB_ESCPOS',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!printer) {
      this.referenceError('测试任务仅允许同一商家的 USB ESC/POS 打印机');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, nameZh: true, addressZh: true, contactPhone: true },
    });
    if (!merchant) this.referenceError('商家不存在');
    const generatedAt = new Date().toISOString();
    return this.createTestJob({
      merchantId,
      printerId,
      createdByStaffId,
      requestId,
      requestKey,
      document: {
        schemaVersion: 1,
        receiptType: 'ORDER_CUSTOMER',
        generatedAt,
        merchant: {
          id: merchant.id.toString(),
          name: merchant.nameZh,
          address: merchant.addressZh ?? undefined,
          phone: merchant.contactPhone,
        },
        order: {
          id: '0',
          orderNo: `USB-TEST-${Date.now()}`.slice(0, 32),
          orderType: 'TEST',
          createdAt: generatedAt,
        },
        items: [
          {
            name: '云桥 USB 打印测试',
            nameVi: 'Kiem tra in USB YunQiao',
            nameEn: 'YunQiao USB print test',
            quantity: 1,
            unitPrice: 0,
            lineTotal: 0,
          },
        ],
        totals: { subtotal: 0, total: 0, currency: 'VND' },
        note: 'Synthetic test only - no customer data',
        verificationCode: `YQ:USB-TEST:${Date.now()}`,
      },
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
    allowAutomatic = false,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id: terminalId, merchantId, status: 'ACTIVE', revokedAt: null },
      include: { merchant: { select: { status: true, printingEnabled: true } } },
    });
    if (!terminal) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '终端未启用或不属于当前商家',
      });
    }
    if (
      terminal.merchant.status !== 'ACTIVE' ||
      !terminal.merchant.printingEnabled
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.MERCHANT_PRINTING_DISABLED,
        message: '商家账号或打印总开关当前关闭',
      });
    }
    if (!terminal.boundPrinterId) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端尚未绑定 USB 打印机',
      });
    }
    const boundPrinterId = terminal.boundPrinterId;
    const automaticAllowed =
      allowAutomatic && this.flags.automaticCreationEnabled();

    await this.releaseExpiredLeases(new Date());
    await this.releaseAvailableRetries(new Date(), merchantId);
    if (automaticAllowed) {
      // Durable trigger rows are the crash-recovery path for the small window
      // between committing an order transition and creating its PrintJob.
      await this.processPendingAutomaticTriggers(merchantId);
    }

    const active = await this.findActiveTerminalJob(merchantId, terminalId);
    if (active) return active;

    for (let round = 0; round < 3; round += 1) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const locked = await tx.merchantTerminal.updateMany({
          where: {
            id: terminalId,
            merchantId,
            status: 'ACTIVE',
            revokedAt: null,
            boundPrinterId,
            tokenVersion: terminal.tokenVersion,
          },
          data: { lastSeenAt: now },
        });
        if (locked.count !== 1) return null;
        const alreadyClaimed = await tx.printJob.findFirst({
          where: {
            merchantId,
            claimedByTerminalId: terminalId,
            status: { in: ['CLAIMED', 'PRINTING'] },
            leaseExpiresAt: { gt: now },
          },
          orderBy: { claimedAt: 'asc' },
        });
        if (alreadyClaimed) return alreadyClaimed;
        const candidate = await tx.printJob.findFirst({
          where: {
            merchantId,
            status: 'PENDING',
            availableAt: { lte: now },
            retryBlocked: false,
            OR: [
              { source: { in: ['MANUAL', 'MANUAL_REPRINT', 'TEST'] } },
              ...(automaticAllowed
                ? [
                    {
                      source: 'AUTOMATIC' as const,
                      printRule: { enabled: true, autoPrint: true },
                    },
                  ]
                : []),
            ],
            printerId: boundPrinterId,
            printer: {
              merchantId,
              enabled: true,
              deletedAt: null,
              channelType: 'LOCAL_USB_ESCPOS',
            },
          },
          orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }, { id: 'asc' }],
        });
        if (!candidate) return null;
        const leaseExpiresAt = new Date(
          now.getTime() + Math.min(120_000, Math.max(5_000, leaseMs)),
        );
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

  async claimNextMerchantJob(
    merchantId: bigint,
    printerId?: bigint,
    leaseMs = 30_000,
    allowAutomatic = false,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    await this.settings.assertMerchantEnabled(merchantId);
    const printer = printerId
      ? await this.requireEnabledPrinter(merchantId, printerId)
      : await this.requireDefaultUsbPrinter(merchantId);
    const automaticAllowed =
      allowAutomatic && this.flags.automaticCreationEnabled();

    await this.releaseExpiredLeases(new Date());
    await this.releaseAvailableRetries(new Date(), merchantId);
    if (automaticAllowed) {
      await this.processPendingAutomaticTriggers(merchantId);
    }

    const active = await this.findActiveMerchantConnectorJob(merchantId, printer.id);
    if (active) return active;

    for (let round = 0; round < 3; round += 1) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const candidate = await tx.printJob.findFirst({
          where: {
            merchantId,
            status: 'PENDING',
            availableAt: { lte: now },
            retryBlocked: false,
            OR: [
              { source: { in: ['MANUAL', 'MANUAL_REPRINT', 'TEST'] } },
              ...(automaticAllowed
                ? [
                    {
                      source: 'AUTOMATIC' as const,
                      printRule: { enabled: true, autoPrint: true },
                    },
                  ]
                : []),
            ],
            printerId: printer.id,
            printer: {
              merchantId,
              enabled: true,
              deletedAt: null,
              channelType: 'LOCAL_USB_ESCPOS',
            },
          },
          orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }, { id: 'asc' }],
        });
        if (!candidate) return null;
        const leaseExpiresAt = new Date(
          now.getTime() + Math.min(120_000, Math.max(5_000, leaseMs)),
        );
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
            claimedByTerminalId: null,
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

  findActiveTerminalJob(merchantId: bigint, terminalId: bigint) {
    return this.prisma.printJob.findFirst({
      where: {
        merchantId,
        claimedByTerminalId: terminalId,
        status: { in: ['CLAIMED', 'PRINTING'] },
        leaseExpiresAt: { gt: new Date() },
      },
      orderBy: { claimedAt: 'asc' },
    });
  }

  findActiveMerchantConnectorJob(merchantId: bigint, printerId?: bigint) {
    return this.prisma.printJob.findFirst({
      where: {
        merchantId,
        claimedByTerminalId: null,
        printerId,
        status: { in: ['CLAIMED', 'PRINTING'] },
        leaseExpiresAt: { gt: new Date() },
      },
      orderBy: { claimedAt: 'asc' },
    });
  }

  async connectorJobPayload(
    merchantId: bigint,
    terminalId: bigint | null,
    jobId: bigint,
  ) {
    const job = await this.prisma.printJob.findFirst({
      where: {
        id: jobId,
        merchantId,
        claimedByTerminalId: terminalId,
        status: { in: ['CLAIMED', 'PRINTING'] },
      },
      include: {
        printer: {
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
        attempts: {
          where: { finishedAt: null },
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: {
            id: true,
            attemptNo: true,
            adapter: true,
            startedAt: true,
            contentHash: true,
          },
        },
      },
    });
    if (!job) this.notFound();
    const contentHash =
      job.receiptSnapshotHash ?? receiptSnapshotHash(job.receiptSnapshot);
    if (!job.receiptSnapshotHash) {
      await this.prisma.printJob.updateMany({
        where: { id: job.id, merchantId, receiptSnapshotHash: null },
        data: { receiptSnapshotHash: contentHash },
      });
    }
    const snapshot = job.receiptSnapshot as Record<string, unknown>;
    return {
      id: job.id,
      printerId: job.printerId,
      receiptType: job.receiptType,
      triggerEvent: job.triggerEvent,
      source: job.source,
      status: job.status,
      priority: job.priority,
      copyIndex: job.copyIndex,
      copyCount: job.copyCount,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      leaseVersion: job.leaseVersion,
      leaseExpiresAt: job.leaseExpiresAt,
      contentHash,
      snapshotSchemaVersion: snapshot.schemaVersion,
      receiptSnapshot: job.receiptSnapshot,
      printer: job.printer,
      currentAttempt: job.attempts[0] ?? null,
    };
  }

  async reportMerchantConnectorPrinterStatus(
    merchantId: bigint,
    dto: ReportTerminalPrinterStatusDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const printerId = BigInt(dto.printerId);
    const capabilities = dto.capabilities
      ? normalizeConnectorJson(dto.capabilities)
      : undefined;
    const persistedStatus =
      dto.status === 'CONNECTED'
        ? 'ONLINE'
        : dto.status === 'DISCONNECTED'
          ? 'OFFLINE'
          : dto.status;
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: printerId,
        merchantId,
        channelType: 'LOCAL_USB_ESCPOS',
        deletedAt: null,
      },
      select: { id: true, capabilities: true },
    });
    if (!printer) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'USB 打印机不存在或不属于当前商家',
      });
    }
    const currentCapabilities = isPlainObject(printer.capabilities)
      ? printer.capabilities
      : {};
    return this.prisma.printer.update({
      where: { id: printer.id },
      data: {
        status: persistedStatus,
        capabilities: capabilities
          ? normalizeConnectorJson({
              ...currentCapabilities,
              connectorStatus: capabilities,
              connectorStatusUpdatedAt: new Date().toISOString(),
            })
          : undefined,
      },
    });
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
        receiptSnapshotHash: receiptSnapshotHash(input.snapshot),
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
    if (printer.channelType !== 'LOCAL_USB_ESCPOS') {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
        message: '当前 Release Candidate 仅允许 USB ESC/POS 打印任务',
      });
    }
    return printer;
  }

  private async requireDefaultUsbPrinter(merchantId: bigint) {
    const printer = await this.prisma.printer.findFirst({
      where: {
        merchantId,
        enabled: true,
        deletedAt: null,
        channelType: 'LOCAL_USB_ESCPOS',
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    if (!printer) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '当前商家没有已启用的 USB ESC/POS 打印机',
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

  private automaticTriggeringEnabled() {
    return (
      this.flags.taskCenterEnabled() &&
      this.flags.automaticCreationEnabled() &&
      !this.flags.legacyPrintingEnabled()
    );
  }

  private assertAutomaticEventKey(eventKey: string) {
    if (!eventKey.trim() || eventKey.length > 191) {
      this.referenceError('自动打印事件标识不能为空且不能超过 191 个字符');
    }
  }

  private outboxEventKey(
    merchantId: bigint,
    orderStatusLogId: bigint,
    triggerEvent: PrintTriggerEvent,
    ruleId: bigint,
    ruleVersion: string,
  ) {
    const digest = createHash('sha256')
      .update(
        ['trigger-v1', merchantId, orderStatusLogId, triggerEvent, ruleId, ruleVersion].join(
          ':',
        ),
      )
      .digest('hex');
    return `auto-trigger:${digest}`;
  }

  private automaticDedupeKey(input: {
    merchantId: bigint;
    eventKey: string;
    printerId: bigint;
    receiptType: ReceiptType;
    triggerEvent: PrintTriggerEvent;
    ruleId: bigint;
    ruleVersion: string;
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
      input.ruleVersion,
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
    ruleVersion: string;
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
          input.ruleVersion,
        ].join(':'),
      )
      .digest('hex');
  }

  private manualDedupeKey(
    merchantId: bigint,
    staffId: bigint,
    operationKey: string,
    requestKey: string,
  ) {
    return `manual:${createHash('sha256')
      .update(`v1:${merchantId}:${staffId}:${operationKey}:${requestKey}`)
      .digest('hex')}`;
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

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'code' in response) {
      return String((response as { code: unknown }).code).slice(0, 64);
    }
  }
  return error instanceof Error ? error.name : 'UNKNOWN';
}

function outboxRetryDelay(attemptNo: number) {
  return Math.min(300_000, 5_000 * 2 ** Math.max(0, attemptNo - 1));
}

function normalizeConnectorJson(value: Record<string, unknown>) {
  assertNoSensitiveConnectorKeys(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 8_192) {
      throw new Error('connector payload exceeds 8192 bytes');
    }
    return JSON.parse(serialized) as Prisma.InputJsonObject;
  } catch (error) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message:
        error instanceof Error && error.message.includes('8192')
          ? '打印连接器诊断信息过大'
          : '打印连接器诊断信息必须是有效 JSON',
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertNoSensitiveConnectorKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '打印连接器诊断信息不允许包含敏感字段',
      });
    }
    assertNoSensitiveConnectorKeys(nested);
  }
}
