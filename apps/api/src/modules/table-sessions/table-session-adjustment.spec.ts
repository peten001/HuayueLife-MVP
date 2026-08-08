import { TableSessionsService } from './table-sessions.service';

function buildHarness(overrides: Record<string, unknown> = {}) {
  const merchantId = 7n;
  const staffId = 11n;
  const sessionId = 17n;
  const tableId = 13n;
  const sessionRow = {
    id: sessionId,
    merchant_id: merchantId,
    table_id: tableId,
    status: 'OPEN',
    open_table_id: tableId,
    closed_at: null,
    discount_payable_rate_bps: null,
    discount_amount_vnd: 0n,
    discount_applied_by_staff_id: null,
    discount_applied_at: null,
    rounding_amount_vnd: 0n,
    rounding_applied_by_staff_id: null,
    ...overrides,
  };
  const transaction = {
    tableSession: {
      findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId }),
      update: jest.fn().mockResolvedValue({ id: sessionId }),
    },
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: tableId, status: 'ACTIVE' }])
      .mockResolvedValueOnce([sessionRow])
      .mockResolvedValueOnce([{
        status: 'ACCEPTED',
        order_type: 'DINE_IN',
        total_amount_vnd: 1_003_000n,
      }]),
  };
  const prisma = {
    $transaction: jest.fn(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };
  const service = new TableSessionsService(prisma as never, {} as never);
  jest.spyOn(service, 'getSessionDetail').mockResolvedValue({
    session: { id: sessionId },
  } as never);
  return { merchantId, staffId, sessionId, transaction, service };
}

describe('TableSessionsService settlement adjustment', () => {
  it('persists discount and rounding together under the existing locks', async () => {
    const harness = buildHarness();

    await harness.service.setSettlementAdjustment(
      harness.merchantId,
      harness.staffId,
      harness.sessionId,
      { discountPayableRateBps: 9_000, roundingEnabled: true },
    );

    expect(harness.transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(harness.transaction.tableSession.update).toHaveBeenCalledWith({
      where: { id: harness.sessionId },
      data: expect.objectContaining({
        discountPayableRateBps: 9_000,
        discountAmountVnd: 100_300n,
        discountAppliedByStaffId: harness.staffId,
        discountAppliedAt: expect.any(Date),
        roundingAmountVnd: 2_700n,
        roundingAppliedByStaffId: harness.staffId,
      }),
    });
  });

  it('keeps discount metadata when the legacy rounding endpoint changes rounding', async () => {
    const harness = buildHarness({
      discount_payable_rate_bps: 9_000,
      discount_amount_vnd: 100_300n,
      discount_applied_by_staff_id: 29n,
      discount_applied_at: new Date('2026-08-08T08:00:00.000Z'),
      rounding_amount_vnd: 2_700n,
      rounding_applied_by_staff_id: 29n,
    });

    await harness.service.setRounding(
      harness.merchantId,
      harness.staffId,
      harness.sessionId,
      false,
    );

    expect(harness.transaction.tableSession.update).toHaveBeenCalledWith({
      where: { id: harness.sessionId },
      data: {
        roundingAmountVnd: 0n,
        roundingAppliedByStaffId: null,
      },
    });
  });

  it('cancels discount while keeping rounding enabled and recalculating it', async () => {
    const harness = buildHarness({
      discount_payable_rate_bps: 9_000,
      discount_amount_vnd: 100_300n,
      discount_applied_by_staff_id: 11n,
      discount_applied_at: new Date(),
      rounding_amount_vnd: 2_700n,
      rounding_applied_by_staff_id: 11n,
    });

    await harness.service.setSettlementAdjustment(
      harness.merchantId,
      harness.staffId,
      harness.sessionId,
      { discountPayableRateBps: null, roundingEnabled: true },
    );

    expect(harness.transaction.tableSession.update).toHaveBeenCalledWith({
      where: { id: harness.sessionId },
      data: expect.objectContaining({
        discountPayableRateBps: null,
        discountAmountVnd: 0n,
        discountAppliedByStaffId: null,
        discountAppliedAt: null,
        roundingAmountVnd: 3_000n,
        roundingAppliedByStaffId: harness.staffId,
      }),
    });
  });

  it('is idempotent and rejects closed or unowned sessions', async () => {
    const same = buildHarness({
      discount_payable_rate_bps: 9_000,
      discount_amount_vnd: 100_300n,
    });
    await same.service.setSettlementAdjustment(
      same.merchantId,
      same.staffId,
      same.sessionId,
      { discountPayableRateBps: 9_000, roundingEnabled: false },
    );
    expect(same.transaction.tableSession.update).not.toHaveBeenCalled();

    const closed = buildHarness({ status: 'CLOSED' });
    await expect(closed.service.setSettlementAdjustment(
      closed.merchantId,
      closed.staffId,
      closed.sessionId,
      { discountPayableRateBps: 9_000, roundingEnabled: false },
    )).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_CLOSED' } });

    const unowned = buildHarness();
    unowned.transaction.tableSession.findFirst.mockResolvedValueOnce(null);
    await expect(unowned.service.setSettlementAdjustment(
      unowned.merchantId,
      unowned.staffId,
      unowned.sessionId,
      { discountPayableRateBps: 9_000, roundingEnabled: false },
    )).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_NOT_FOUND' } });
  });
});
