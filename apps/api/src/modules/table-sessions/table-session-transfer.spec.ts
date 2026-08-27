import { TableSessionsService } from './table-sessions.service';

const merchantId = 7n;
const staffId = 11n;
const sessionId = 17n;
const sourceTableId = 13n;
const targetTableId = 19n;

function transferHarness(options: {
  currentTableId?: bigint;
  targetStatus?: string;
  occupied?: boolean;
  missingTarget?: boolean;
  orders?: Array<{ id: bigint; status: string }>;
} = {}) {
  const currentTableId = options.currentTableId ?? sourceTableId;
  const tableSession = {
    findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId: currentTableId }),
    update: jest.fn().mockResolvedValue({ id: sessionId }),
  };
  const order = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const orderStatusLog = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const lockRows = currentTableId === targetTableId
    ? [[{ id: targetTableId, status: options.targetStatus ?? 'ACTIVE' }]]
    : [
        [{ id: sourceTableId, status: 'ACTIVE' }],
        options.missingTarget ? [] : [{ id: targetTableId, status: options.targetStatus ?? 'ACTIVE' }],
      ];
  const rawResults = [
    ...lockRows,
    [{
      id: sessionId,
      merchant_id: merchantId,
      table_id: currentTableId,
      status: 'OPEN',
      open_table_id: currentTableId,
      closed_at: null,
      rounding_amount_vnd: 1700n,
      rounding_applied_by_staff_id: staffId,
      discount_payable_rate_bps: 9000,
      discount_amount_vnd: 51300n,
      discount_applied_by_staff_id: staffId,
      discount_applied_at: new Date('2026-08-27T00:00:00.000Z'),
    }],
    ...(currentTableId === targetTableId ? [] : [
      options.occupied ? [{ id: 99n }] : [],
      options.orders ?? [
        { id: 23n, status: 'ACCEPTED' },
        { id: 29n, status: 'PENDING_ACCEPTANCE' },
      ],
    ]),
  ];
  const transaction = {
    tableSession,
    order,
    orderStatusLog,
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(rawResults.shift() ?? [])),
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
  };
  const printJobs = {
    enqueueAutomaticTriggersForOrderTransition: jest.fn(),
    enqueueAutomaticTableSessionCheckout: jest.fn(),
    processAutomaticTriggerIds: jest.fn(),
  };
  const service = new TableSessionsService(prisma as never, printJobs as never);
  const snapshot = {
    session: {
      id: sessionId,
      merchantId,
      tableId: targetTableId,
      tableNo: 'A02',
      status: 'OPEN',
      businessDate: '2026-08-27',
      discountPayableRateBps: 9000,
      roundingAmountVnd: 1700n,
      orders: [{ id: 23n }, { id: 29n }],
    },
  };
  jest.spyOn(service, 'getSessionDetail').mockResolvedValue(snapshot as never);
  return { service, prisma, transaction, printJobs, snapshot };
}

const input = {
  targetTableId,
  expectedSourceTableId: sourceTableId,
  requestKey: 'transfer-request-001',
};

describe('TableSessionsService whole-table transfer V1', () => {
  it('moves the same session and bound orders while preserving settlement fields and creating no print work', async () => {
    const harness = transferHarness();

    await expect(harness.service.transferSession(merchantId, staffId, sessionId, input))
      .resolves.toEqual(harness.snapshot);

    expect(harness.transaction.tableSession.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { tableId: targetTableId, openTableId: targetTableId },
    });
    expect(harness.transaction.tableSession.update.mock.calls[0]?.[0].data).not.toHaveProperty('businessDate');
    expect(harness.transaction.tableSession.update.mock.calls[0]?.[0].data).not.toHaveProperty('discountPayableRateBps');
    expect(harness.transaction.tableSession.update.mock.calls[0]?.[0].data).not.toHaveProperty('roundingAmountVnd');
    expect(harness.transaction.order.updateMany).toHaveBeenCalledWith({
      where: { merchantId, tableSessionId: sessionId },
      data: { tableId: targetTableId },
    });
    expect(harness.transaction.orderStatusLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          orderId: 23n,
          action: 'TABLE_SESSION_TRANSFERRED',
          requestKey: input.requestKey,
          metadata: {
            tableSessionId: sessionId.toString(),
            sourceTableId: sourceTableId.toString(),
            targetTableId: targetTableId.toString(),
          },
        }),
      ]),
      skipDuplicates: true,
    });
    expect(harness.printJobs.enqueueAutomaticTriggersForOrderTransition).not.toHaveBeenCalled();
    expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).not.toHaveBeenCalled();
    expect(harness.printJobs.processAutomaticTriggerIds).not.toHaveBeenCalled();
  });

  it('rejects an occupied target before changing the session or orders', async () => {
    const harness = transferHarness({ occupied: true });
    await expect(harness.service.transferSession(merchantId, staffId, sessionId, input))
      .rejects.toMatchObject({ response: { code: 'TABLE_TRANSFER_TARGET_OCCUPIED' } });
    expect(harness.transaction.tableSession.update).not.toHaveBeenCalled();
    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a disabled or cross-merchant target', async () => {
    const disabled = transferHarness({ targetStatus: 'DISABLED' });
    await expect(disabled.service.transferSession(merchantId, staffId, sessionId, input))
      .rejects.toMatchObject({ response: { code: 'TABLE_TRANSFER_TARGET_NOT_AVAILABLE' } });

    const missing = transferHarness({ missingTarget: true });
    await expect(missing.service.transferSession(merchantId, staffId, sessionId, input))
      .rejects.toMatchObject({ response: { code: 'TABLE_NOT_FOUND' } });
  });

  it('rejects a stale source race and keeps all writes untouched', async () => {
    const harness = transferHarness({ currentTableId: 31n });
    await expect(harness.service.transferSession(merchantId, staffId, sessionId, input))
      .rejects.toMatchObject({ response: { code: 'TABLE_TRANSFER_SOURCE_CHANGED' } });
    expect(harness.transaction.tableSession.update).not.toHaveBeenCalled();
    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it('returns the authoritative session on a double-submit retry without duplicate writes', async () => {
    const harness = transferHarness({ currentTableId: targetTableId });
    await expect(harness.service.transferSession(merchantId, staffId, sessionId, input))
      .resolves.toEqual(harness.snapshot);
    expect(harness.transaction.tableSession.update).not.toHaveBeenCalled();
    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.orderStatusLog.createMany).not.toHaveBeenCalled();
  });

  it('rejects a same-table request before opening a transaction', async () => {
    const harness = transferHarness();
    await expect(harness.service.transferSession(merchantId, staffId, sessionId, {
      ...input,
      targetTableId: sourceTableId,
    })).rejects.toMatchObject({ response: { code: 'TABLE_TRANSFER_SAME_TABLE' } });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });
});
