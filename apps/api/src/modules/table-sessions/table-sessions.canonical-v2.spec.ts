import { canonicalPayloadHash, DineInCanonicalStateService, type DineInCanonicalStateInternal } from './dine-in-canonical-state.service';
import { TableSessionsService } from './table-sessions.service';

describe('TableSessionsService Canonical State V2 actions', () => {
  describe('release-empty', () => {
    it('closes an OPEN zero-amount session without payment, settlement, receipt, or print', async () => {
      const harness = releaseHarness(state(0));
      await expect(harness.service.releaseEmptySession(7n, 3n, 51n, harness.input)).resolves.toEqual(harness.detail);
      expect(harness.tx.tableSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', openTableId: 11n }),
        data: expect.objectContaining({ status: 'CLOSED', openTableId: null }),
      }));
      const data = harness.tx.tableSession.updateMany.mock.calls[0]?.[0].data;
      expect(data).not.toHaveProperty('paymentMethod');
      expect(data).not.toHaveProperty('businessDate');
      expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).not.toHaveBeenCalled();
    });

    it('rejects a session that still has items', async () => {
      const harness = releaseHarness(state(1));
      await expect(harness.service.releaseEmptySession(7n, 3n, 51n, harness.input)).rejects.toMatchObject({ response: { code: 'CANONICAL_EMPTY_RELEASE_NOT_ALLOWED' } });
      expect(harness.tx.tableSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a nonzero payable amount even when item projection is empty', async () => {
      const current = state(0);
      current.totals.originalAmountVnd = '1000';
      current.totals.payableAmountVnd = '1000';
      const harness = releaseHarness(current);
      await expect(harness.service.releaseEmptySession(7n, 3n, 51n, harness.input)).rejects.toMatchObject({ response: { code: 'CANONICAL_EMPTY_RELEASE_NOT_ALLOWED' } });
    });

    it('rejects a stale expected revision with latest state', async () => {
      const harness = releaseHarness(state(0));
      harness.input.expectedRevision = `dcs2:sha256:${'f'.repeat(64)}`;
      await expect(harness.service.releaseEmptySession(7n, 3n, 51n, harness.input)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CANONICAL_REVISION_CONFLICT', latestState: expect.any(Object) }) });
    });

    it('rejects a closed session and a non-DINE_IN blocker', async () => {
      const closed = state(1); closed.sessionStatus = 'CLOSED';
      await expect(releaseHarness(closed).service.releaseEmptySession(7n, 3n, 51n, releaseHarness(closed).input)).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_EXTERNALLY_CLOSED' } });
      const blocked = state(0); blocked.blockers = ['NON_DINE_IN_ORDER'];
      const harness = releaseHarness(blocked);
      await expect(harness.service.releaseEmptySession(7n, 3n, 51n, harness.input)).rejects.toMatchObject({ response: { code: 'CANONICAL_EMPTY_RELEASE_NOT_ALLOWED' } });
    });

    it('returns an idempotent replay without a second close', async () => {
      const current = state(0);
      const harness = releaseHarness(current);
      const payloadHash = canonicalPayloadHash({ sessionId: '51', expectedRevision: current.revision, action: 'RELEASE_EMPTY' });
      harness.tx.$queryRaw.mockReset()
        .mockResolvedValueOnce([{ id: 11n, status: 'ACTIVE' }])
        .mockResolvedValueOnce([{ action: 'DINE_IN_EMPTY_SESSION_RELEASED', metadata: { payloadHash } }]);
      await harness.service.releaseEmptySession(7n, 3n, 51n, harness.input);
      expect(harness.tx.tableSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('checkout V2', () => {
    it.each(['CASH', 'BANK_TRANSFER'] as const)('checks out with matching revision and %s', async (paymentMethod) => {
      const harness = checkoutHarness(state(1));
      await harness.service.checkoutSession(7n, 3n, 51n, paymentMethod, harness.input);
      expect(harness.tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', paymentMethod }) }));
      expect(harness.tx.tableSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', paymentMethod }) }));
      expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).toHaveBeenCalledTimes(1);
    });

    it('rejects a revision mismatch with zero financial and printing side effects', async () => {
      const harness = checkoutHarness(state(1));
      harness.input.expectedRevision = `dcs2:sha256:${'f'.repeat(64)}`;
      await expect(harness.service.checkoutSession(7n, 3n, 51n, 'CASH', harness.input)).rejects.toMatchObject({ response: { code: 'CHECKOUT_REVISION_CONFLICT' } });
      expect(harness.tx.order.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.tableSession.updateMany).not.toHaveBeenCalled();
      expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).not.toHaveBeenCalled();
    });

    it('detects a QR or staff order arriving before checkout as the same revision conflict', async () => {
      const latest = state(2);
      const harness = checkoutHarness(latest);
      harness.input.expectedRevision = state(1).revision;
      await expect(harness.service.checkoutSession(7n, 3n, 51n, 'CASH', harness.input)).rejects.toMatchObject({ response: { code: 'CHECKOUT_REVISION_CONFLICT' } });
    });

    it('replays the exact checkout request without duplicate completion or print intent', async () => {
      const current = state(1);
      const harness = checkoutHarness(current, 'CLOSED');
      const payloadHash = canonicalPayloadHash({ sessionId: '51', expectedRevision: current.revision, paymentMethod: 'CASH' });
      harness.tx.$queryRaw.mockReset()
        .mockResolvedValueOnce([{ id: 11n, status: 'ACTIVE' }])
        .mockResolvedValueOnce([sessionRow('CLOSED')])
        .mockResolvedValueOnce([{ action: 'TABLE_SESSION_CHECKOUT', metadata: { payloadHash } }]);
      await harness.service.checkoutSession(7n, 3n, 51n, 'CASH', harness.input);
      expect(harness.tx.order.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.tableSession.updateMany).not.toHaveBeenCalled();
      expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).not.toHaveBeenCalled();
    });

    it('requires explicit release-empty instead of producing a zero checkout receipt', async () => {
      const harness = checkoutHarness(state(0));
      await expect(harness.service.checkoutSession(7n, 3n, 51n, 'CASH', harness.input)).rejects.toMatchObject({ response: { code: 'EMPTY_TABLE_SESSION_REQUIRES_RELEASE' } });
      expect(harness.printJobs.enqueueAutomaticTableSessionCheckout).not.toHaveBeenCalled();
    });
  });
});

function releaseHarness(current: DineInCanonicalStateInternal) {
  const tx = {
    tableSession: {
      findFirst: jest.fn().mockResolvedValue({ id: 51n, tableId: 11n }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 91n }) },
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: 11n, status: 'ACTIVE' }])
      .mockResolvedValueOnce([]),
  };
  const canonical = new DineInCanonicalStateService({} as never);
  jest.spyOn(canonical, 'buildLockedWithClient').mockResolvedValue(current);
  const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
  const printJobs = { enqueueAutomaticTableSessionCheckout: jest.fn() };
  const service = new TableSessionsService(prisma as never, printJobs as never, canonical);
  const detail = { session: { id: 51n, status: 'CLOSED' } };
  jest.spyOn(service, 'getSessionDetail').mockResolvedValue(detail as never);
  return { service, tx, printJobs, detail, input: { requestKey: 'release_request_0001', expectedRevision: current.revision } };
}

function checkoutHarness(current: DineInCanonicalStateInternal, sessionStatus = 'OPEN') {
  const tx = {
    tableSession: {
      findFirst: jest.fn().mockResolvedValue({ id: 51n, tableId: 11n }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
    orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 91n }) },
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: 11n, status: 'ACTIVE' }])
      .mockResolvedValueOnce([sessionRow(sessionStatus)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 41n, status: 'ACCEPTED', order_type: 'DINE_IN', item_amount_vnd: 12_000n, total_amount_vnd: 12_000n, business_date: null, created_at: new Date('2026-08-30T00:00:00.000Z') }]),
  };
  const canonical = new DineInCanonicalStateService({} as never);
  jest.spyOn(canonical, 'buildLockedWithClient').mockResolvedValue(current);
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const printJobs = {
    enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([]),
    enqueueAutomaticTableSessionCheckout: jest.fn().mockResolvedValue([]),
    processAutomaticTriggerIds: jest.fn(),
  };
  const service = new TableSessionsService(prisma as never, printJobs as never, canonical);
  jest.spyOn(service, 'getSessionDetail').mockResolvedValue({ session: { id: 51n, status: 'CLOSED', orders: [] } } as never);
  return { service, tx, printJobs, input: { requestKey: 'checkout_request_0001', expectedRevision: current.revision } };
}

function sessionRow(status: string) {
  return {
    id: 51n, merchant_id: 7n, table_id: 11n, status, open_table_id: status === 'OPEN' ? 11n : null, closed_at: status === 'OPEN' ? null : new Date(),
    discount_payable_rate_bps: null, discount_amount_vnd: 0n, discount_applied_by_staff_id: null, discount_applied_at: null,
    rounding_amount_vnd: 0n, rounding_applied_by_staff_id: null,
  };
}

function state(quantity: number): DineInCanonicalStateInternal {
  return {
    sessionId: '51', tableId: '11', tableNo: 'A01', tableName: null, sessionStatus: 'OPEN',
    revision: `dcs2:sha256:${quantity.toString().padStart(64, '0')}`,
    items: quantity ? [{
      lineKey: `dline:sha256:${'1'.repeat(64)}`, productId: '31', productNameZh: '鱼香茄子', productNameVi: null, productNameEn: null,
      remark: '', optionSignature: '', unitPriceVnd: '12000', quantity, lockedQuantity: 0, adjustableQuantity: quantity,
      subtotalVnd: (BigInt(quantity) * 12_000n).toString(), adjustability: 'RETURN', sourceSummary: { staffQuantity: quantity, qrQuantity: 0 },
      rawItems: [{ itemId: 71n, orderId: 41n, orderStatus: 'ACCEPTED', quantity, unitPriceVnd: 12_000n }],
    }] : [],
    totals: { originalAmountVnd: (BigInt(quantity) * 12_000n).toString(), discountPayableRateBps: null, discountAmountVnd: '0', roundingAmountVnd: '0', payableAmountVnd: (BigInt(quantity) * 12_000n).toString() },
    blockers: [], generatedAt: '2026-08-30T00:00:00.000Z',
  };
}
