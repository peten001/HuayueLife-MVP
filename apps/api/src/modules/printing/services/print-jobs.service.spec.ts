import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptDocument } from '../types/receipt-document';
import { PrintJobsService } from './print-jobs.service';

const merchantId = 7n;
const printerId = 17n;
const templateId = 27n;
const orderId = 37n;
const tableSessionId = 47n;
const ruleId = 57n;
const terminalId = 67n;

const receipt: ReceiptDocument = {
  schemaVersion: 1,
  receiptType: 'ORDER_CUSTOMER',
  generatedAt: '2026-07-15T00:00:00.000Z',
  merchant: { id: merchantId.toString(), name: '测试商家' },
  order: {
    id: orderId.toString(),
    orderNo: 'TEST-ORDER',
    orderType: 'DINE_IN',
    createdAt: '2026-07-15T00:00:00.000Z',
  },
  items: [{ name: '测试菜品', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
  totals: { subtotal: 1000, total: 1000, currency: 'VND' },
};

describe('PrintJobsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: ReturnType<typeof createFlagsMock>;
  let snapshots: {
    fromOrder: jest.Mock;
    fromTableSession: jest.Mock;
    cloneAndValidate: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let service: PrintJobsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = createFlagsMock();
    snapshots = {
      fromOrder: jest.fn().mockResolvedValue(receipt),
      fromTableSession: jest.fn(),
      cloneAndValidate: jest.fn((value: ReceiptDocument) =>
        JSON.parse(JSON.stringify(value)),
      ),
    };
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    prisma.printJob.findMany.mockResolvedValue([]);
    prisma.merchantStaff.findFirst.mockResolvedValue({ id: 3n });
    service = new PrintJobsService(
      prisma as never,
      flags as never,
      snapshots as never,
      audit as never,
      { assertMerchantEnabled: jest.fn() } as never,
    );
  });

  it('deduplicates automatic jobs and returns the original jobs after P2002', async () => {
    const existing = { id: 99n, merchantId, dedupeKey: 'existing' };
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create.mockRejectedValue(uniqueViolation());
    prisma.printJob.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing]);

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).resolves.toEqual([existing]);

    expect(flags.assertAutomaticCreationEnabled).toHaveBeenCalledTimes(1);
    expect(snapshots.fromOrder).toHaveBeenCalledWith(merchantId, orderId);
    expect(prisma.printJob.findMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        dedupeKey: { in: [expect.stringMatching(/^auto:[a-f0-9]{64}$/)] },
      },
      orderBy: { copyIndex: 'asc' },
    });
  });

  it('captures the selected template version and expands each configured copy into its own job', async () => {
    const created = { id: 101n };
    prisma.printRule.findFirst.mockResolvedValue(automaticRule({ copies: 3 }));
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template({ version: 4 }));
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({ id: 102n })
      .mockResolvedValueOnce({ id: 103n });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).resolves.toEqual([created, { id: 102n }, { id: 103n }]);

    expect(prisma.printJob.create).toHaveBeenCalledTimes(3);
    const jobData = prisma.printJob.create.mock.calls.map(([call]) => call.data);
    expect(jobData.map((data) => data.copyIndex)).toEqual([1, 2, 3]);
    expect(jobData.map((data) => data.copyCount)).toEqual([3, 3, 3]);
    expect(new Set(jobData.map((data) => data.dedupeKey))).toHaveProperty('size', 3);
    expect(new Set(jobData.map((data) => data.requestGroupId)).size).toBe(1);
    for (const data of jobData) {
      expect(data).toEqual(
        expect.objectContaining({
          receiptTemplateId: templateId,
          receiptTemplateVersion: 4,
          receiptSnapshot: receipt,
          printRuleId: ruleId,
        }),
      );
    }
  });

  it('includes the frozen rule version in automatic idempotency', async () => {
    prisma.printRule.findFirst
      .mockResolvedValueOnce(
        automaticRule({ updatedAt: new Date('2026-07-15T00:00:00.000Z') }),
      )
      .mockResolvedValueOnce(
        automaticRule({ updatedAt: new Date('2026-07-16T00:00:00.000Z') }),
      );
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce({ id: 111n })
      .mockResolvedValueOnce({ id: 112n });

    await service.createAutomaticJob({
      merchantId,
      ruleId,
      orderId,
      eventKey: 'order-status-log:stable-9001',
    });
    await service.createAutomaticJob({
      merchantId,
      ruleId,
      orderId,
      eventKey: 'order-status-log:stable-9001',
    });

    const [first, second] = prisma.printJob.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.requestGroupId).not.toBe(second.requestGroupId);
    expect(first.ruleVersion).not.toBe(second.ruleVersion);
  });

  it('creates every manual reprint as a new non-deduplicated job using a cloned snapshot', async () => {
    const originalSnapshot = { ...receipt, note: '原始任务不可变内容' };
    const original = {
      id: 201n,
      merchantId,
      orderId,
      tableSessionId: null,
      printerId,
      receiptTemplateId: templateId,
      receiptType: 'ORDER_CUSTOMER',
      priority: 40,
      receiptSnapshot: originalSnapshot,
    };
    prisma.printJob.findFirst.mockResolvedValue(original);
    prisma.merchantStaff.findFirst.mockResolvedValue({ id: 3n });
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce({ id: 202n, printerId })
      .mockResolvedValueOnce({ id: 203n, printerId });

    await service.createManualReprintJob({
      merchantId,
      originalJobId: original.id,
      createdByStaffId: 3n,
      reason: '顾客要求补打',
      requestKey: 'reprint-request-1',
    });
    await service.createManualReprintJob({
      merchantId,
      originalJobId: original.id,
      createdByStaffId: 3n,
      reason: '再次补打',
      requestKey: 'reprint-request-2',
    });

    expect(snapshots.cloneAndValidate).toHaveBeenCalledTimes(2);
    expect(prisma.printJob.create).toHaveBeenCalledTimes(2);
    for (const [call] of prisma.printJob.create.mock.calls) {
      expect(call.data).toEqual(
        expect.objectContaining({
          source: 'MANUAL_REPRINT',
          triggerEvent: 'MANUAL',
          receiptSnapshot: expect.objectContaining({ note: '原始任务不可变内容' }),
          createdByStaffId: 3n,
        }),
      );
      expect(call.data.dedupeKey).toMatch(/^manual:[a-f0-9]{64}$/);
      expect(call.data.receiptSnapshot).not.toBe(originalSnapshot);
    }
  });

  it('does not disclose a job belonging to another merchant', async () => {
    prisma.printJob.findFirst.mockResolvedValue(null);

    await expect(service.get(merchantId, 999n)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.printJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 999n, merchantId } }),
    );
  });

  it('rejects an automatic rule outside the merchant scope', async () => {
    prisma.printRule.findFirst.mockResolvedValue(null);

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.findFirst).toHaveBeenCalledWith({
      where: { id: ruleId, merchantId, enabled: true, autoPrint: true },
    });
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('rejects job creation when the selected printer is disabled', async () => {
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter({ enabled: false }));
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('rejects an automatic snapshot whose merchant scope does not match the job', async () => {
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    snapshots.fromOrder.mockResolvedValue({
      ...receipt,
      merchant: { ...receipt.merchant, id: '999' },
    });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:scope-mismatch',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('writes one durable outbox row per enabled rule inside the order transaction', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    prisma.merchant.findUnique.mockResolvedValue({ status: 'ACTIVE', printingEnabled: true });
    prisma.printRule.findMany.mockResolvedValue([automaticRule({ copies: 2 })]);
    prisma.printTriggerOutbox.createMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findMany.mockResolvedValue([{ id: 501n }]);

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9001n,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      }),
    ).resolves.toEqual([{ id: 501n }]);

    expect(prisma.printTriggerOutbox.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          merchantId,
          orderId,
          orderStatusLogId: 9001n,
          printRuleId: ruleId,
          triggerEvent: 'ORDER_ACCEPTED',
          ruleVersion: '2026-07-15T00:00:00.000Z',
          copies: 2,
          eventKey: expect.stringMatching(/^auto-trigger:[a-f0-9]{64}$/),
        }),
      ],
    });
  });

  it('does not touch outbox tables while automatic creation remains disabled', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(false);

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9002n,
        orderType: 'DINE_IN',
        status: 'COMPLETED',
      }),
    ).resolves.toEqual([]);

    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    expect(prisma.printTriggerOutbox.createMany).not.toHaveBeenCalled();
  });

  it('does not enqueue automatic output for a disabled merchant even if its old print flag is true', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    prisma.merchant.findUnique.mockResolvedValue({
      status: 'DISABLED',
      printingEnabled: true,
    });

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9003n,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      }),
    ).resolves.toEqual([]);

    expect(prisma.printRule.findMany).not.toHaveBeenCalled();
    expect(prisma.printTriggerOutbox.createMany).not.toHaveBeenCalled();
  });

  it('processes an ACCEPTED outbox event even after the order has advanced', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    const trigger = pendingTrigger({
      status: 'PROCESSING',
      leaseVersion: 1,
      attemptCount: 1,
    });
    prisma.printTriggerOutbox.findFirst.mockResolvedValue(pendingTrigger());
    prisma.printTriggerOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findUniqueOrThrow.mockResolvedValue(trigger);
    prisma.printJob.findMany.mockResolvedValue([]);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    // No current-status predicate is used: PREPARING does not erase the
    // already committed ORDER_ACCEPTED intent.
    prisma.order.findFirst.mockResolvedValue({ id: orderId, status: 'PREPARING' });
    prisma.printJob.create.mockResolvedValue({ id: 601n });

    await expect(service.processAutomaticTriggerIds([trigger.id])).resolves.toEqual([
      { id: trigger.id, outcome: 'PROCESSED' },
    ]);

    expect(snapshots.fromOrder).toHaveBeenCalledWith(merchantId, orderId);
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'AUTOMATIC',
          triggerEvent: 'ORDER_ACCEPTED',
          printRuleId: ruleId,
        }),
      }),
    );
  });

  it('marks a recovered outbox event processed when its deduplicated job already exists', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    const trigger = pendingTrigger({
      status: 'PROCESSING',
      leaseVersion: 3,
      attemptCount: 2,
    });
    prisma.printTriggerOutbox.findFirst.mockResolvedValue(
      pendingTrigger({ leaseVersion: 2 }),
    );
    prisma.printTriggerOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findUniqueOrThrow.mockResolvedValue(trigger);
    prisma.printJob.findMany.mockResolvedValue([{ id: 701n }]);

    await expect(service.processAutomaticTriggerIds([trigger.id])).resolves.toEqual([
      { id: trigger.id, outcome: 'PROCESSED' },
    ]);
    expect(snapshots.fromOrder).not.toHaveBeenCalled();
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('uses compare-and-set so only one competing terminal claims a job', async () => {
    let winner: bigint | null = null;
    const candidate = pendingJob();
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      boundPrinterId: printerId,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.printJob.findFirst.mockImplementation(
      async ({ where }: { where: { status: unknown } }) =>
        typeof where.status === 'object' ? null : candidate,
    );
    prisma.printJob.updateMany.mockImplementation(
      async ({ data }: { data: { claimedByTerminalId: bigint } }) => {
        if (data.claimedByTerminalId === undefined) return { count: 0 };
        if (winner !== null) return { count: 0 };
        winner = data.claimedByTerminalId;
        return { count: 1 };
      },
    );
    prisma.printJob.findUnique.mockImplementation(async () => ({
      ...candidate,
      status: 'CLAIMED',
      claimedByTerminalId: winner,
    }));

    const [first, second] = await Promise.all([
      service.claimNextJob(merchantId, terminalId),
      service.claimNextJob(merchantId, terminalId + 1n),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(winner === terminalId || winner === terminalId + 1n).toBe(true);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          leaseVersion: 0,
        }),
        data: expect.objectContaining({
          status: 'CLAIMED',
          leaseVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('blocks claim when the platform has disabled the merchant', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      boundPrinterId: printerId,
      merchant: { status: 'DISABLED', printingEnabled: true },
    });

    await expect(service.claimNextJob(merchantId, terminalId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.printJob.findFirst).not.toHaveBeenCalled();
  });

  it('compensates durable automatic triggers before an automatic connector claim', async () => {
    flags.automaticCreationEnabled.mockReturnValue(true);
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      boundPrinterId: printerId,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.printJob.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'releaseExpiredLeases').mockResolvedValue({
      claimed: 0,
      printing: 0,
    });
    jest.spyOn(service, 'releaseAvailableRetries').mockResolvedValue(0);
    const compensation = jest
      .spyOn(service, 'processPendingAutomaticTriggers')
      .mockResolvedValue([]);

    await expect(
      service.claimNextJob(merchantId, terminalId, 30_000, true),
    ).resolves.toBeNull();

    expect(compensation).toHaveBeenCalledWith(merchantId);
  });

  it('recovers expired claimed and printing leases without claiming success', async () => {
    prisma.printJob.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.printJob.findMany.mockResolvedValue([
      { id: 301n, attemptCount: 1, maxAttempts: 3 },
    ]);
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date('2026-07-15T01:00:00.000Z');

    await expect(service.releaseExpiredLeases(now)).resolves.toEqual({
      claimed: 2,
      printing: 1,
    });
    expect(prisma.printJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: 301n, status: 'PRINTING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          retryBlocked: true,
          lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: 'OUTCOME_UNKNOWN' }),
      }),
    );
  });

  it('releases only due RETRY_WAIT jobs with remaining attempts back to PENDING', async () => {
    const now = new Date('2026-07-15T01:00:00.000Z');
    prisma.printJob.findMany.mockResolvedValue([
      {
        id: 401n,
        merchantId,
        attemptCount: 1,
        maxAttempts: 3,
        leaseVersion: 5,
      },
      {
        id: 402n,
        merchantId,
        attemptCount: 3,
        maxAttempts: 3,
        leaseVersion: 2,
      },
    ]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.releaseAvailableRetries(now, merchantId)).resolves.toBe(1);
    expect(prisma.printJob.findMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        status: 'RETRY_WAIT',
        availableAt: { lte: now },
        retryBlocked: false,
      },
      select: expect.any(Object),
      take: 100,
    });
    expect(prisma.printJob.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 401n,
        status: 'RETRY_WAIT',
        availableAt: { lte: now },
        retryBlocked: false,
        leaseVersion: 5,
      }),
      data: { status: 'PENDING', leaseVersion: { increment: 1 } },
    });
  });

  it('allows cancellation only before execution begins', async () => {
    prisma.printJob.findFirst.mockResolvedValue({
      ...pendingJob(),
      status: 'PRINTING',
    });

    await expect(
      service.cancel(merchantId, 3n, 'req-1', 301n, '取消原因'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('schedules a safe manual retry without expanding the fixed attempt ceiling', async () => {
    const failed = {
      ...pendingJob(),
      status: 'FAILED',
      attemptCount: 1,
      maxAttempts: 3,
      retryBlocked: false,
      lastErrorCode: 'NETWORK_TIMEOUT',
    };
    prisma.printJob.findFirst.mockResolvedValue(failed);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...failed,
      status: 'RETRY_WAIT',
    });

    await service.retry(merchantId, 3n, 'req-2', failed.id, '排除故障后重试');

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['FAILED', 'RETRY_WAIT'] } }),
        data: expect.objectContaining({
          status: 'RETRY_WAIT',
          availableAt: expect.any(Date),
          retryBlocked: false,
        }),
      }),
    );
    expect(prisma.printJob.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'maxAttempts',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRINT_JOB_RETRIED', reason: '排除故障后重试' }),
      prisma,
    );
  });

  it('blocks blind retry when the previous printing outcome is unknown', async () => {
    prisma.printJob.findFirst.mockResolvedValue({
      ...pendingJob(),
      status: 'FAILED',
      attemptCount: 1,
      retryBlocked: true,
      lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
    });

    await expect(
      service.retry(merchantId, 3n, 'req-unknown', 301n, '尝试盲目重试'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.findFirst).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('rejects retry from an illegal state', async () => {
    prisma.printJob.findFirst.mockResolvedValue(pendingJob());

    await expect(
      service.retry(merchantId, 3n, undefined, 301n),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.findFirst).not.toHaveBeenCalled();
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    assertAutomaticCreationEnabled: jest.fn(),
    assertExecutionEnabled: jest.fn(),
    taskCenterEnabled: jest.fn().mockReturnValue(true),
    automaticCreationEnabled: jest.fn().mockReturnValue(false),
    legacyPrintingEnabled: jest.fn().mockReturnValue(false),
  };
}

function createPrismaMock() {
  const prisma = {
    merchant: { findUnique: jest.fn() },
    printRule: { findFirst: jest.fn(), findMany: jest.fn() },
    printer: { findFirst: jest.fn() },
    receiptTemplate: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
    tableSession: { findFirst: jest.fn() },
    merchantTerminal: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    merchantStaff: { findFirst: jest.fn() },
    printJob: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    printAttempt: { updateMany: jest.fn() },
    printTriggerOutbox: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function automaticRule(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId,
    merchantId,
    printerId,
    receiptTemplateId: templateId,
    receiptType: 'ORDER_CUSTOMER',
    triggerEvent: 'ORDER_ACCEPTED',
    copies: 1,
    priority: 20,
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function enabledPrinter(overrides: Record<string, unknown> = {}) {
  return {
    id: printerId,
    merchantId,
    paperWidth: 'MM80',
    channelType: 'LOCAL_USB_ESCPOS',
    enabled: true,
    deletedAt: null,
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: templateId,
    merchantId,
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    version: 3,
    enabled: true,
    ...overrides,
  };
}

function pendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 301n,
    merchantId,
    printerId,
    status: 'PENDING',
    priority: 100,
    availableAt: new Date('2026-07-15T00:00:00.000Z'),
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

function pendingTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 501n,
    merchantId,
    orderId,
    orderStatusLogId: 9001n,
    printRuleId: ruleId,
    printerId,
    receiptTemplateId: templateId,
    eventKey: `auto-trigger:${'a'.repeat(64)}`,
    triggerEvent: 'ORDER_ACCEPTED',
    ruleVersion: '2026-07-15T00:00:00.000Z',
    receiptType: 'ORDER_CUSTOMER',
    copies: 1,
    priority: 20,
    status: 'PENDING',
    availableAt: new Date('2026-07-15T00:00:00.000Z'),
    claimedAt: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 20,
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate dedupe key', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}
