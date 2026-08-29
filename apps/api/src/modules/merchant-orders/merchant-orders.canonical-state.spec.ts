import { ConflictException } from '@nestjs/common';
import { canonicalPayloadHash, DineInCanonicalStateService, type DineInCanonicalStateInternal } from '../table-sessions/dine-in-canonical-state.service';
import { MerchantOrdersService } from './merchant-orders.service';
import type { ReconcileDineInCanonicalStateDto } from '../table-sessions/dto/dine-in-canonical-state.dto';

describe('MerchantOrdersService canonical reconcile', () => {
  it.each([1, 10])('applies +%i as one accepted staff order', async (delta) => {
    const harness = buildHarness({ desiredQuantity: 1 + delta, afterQuantity: 1 + delta });
    const result = await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    expect(harness.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACCEPTED', orderType: 'DINE_IN' }),
    }));
    expect(harness.tx.order.create.mock.calls[0]?.[0].data.items.create[0]).toMatchObject({ quantity: delta });
    expect(result.items[0]?.quantity).toBe(1 + delta);
  });

  it.each([1, 10])('applies -%i through deterministic raw item allocation', async (delta) => {
    const harness = buildHarness({
      baseQuantity: 11,
      desiredQuantity: 11 - delta,
      afterQuantity: 11 - delta,
      rawQuantity: 11,
    });
    await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    if (delta === 10) expect(harness.tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 1 }) }));
    else expect(harness.tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 10 }) }));
  });

  it('keeps the OPEN session and openTableId when the last item changes 1 to 0', async () => {
    const harness = buildHarness({ desiredQuantity: 0, afterQuantity: 0, aggregateCount: 0 });
    await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    expect(harness.tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
    expect(harness.tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', openTableId: null }) }));
    expect(harness.tx.orderStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ tableSessionAutoClosed: false, tableReleased: false }) }) }));
  });

  it('returns an empty-session no-op without creating a fake order', async () => {
    const harness = buildHarness({ baseQuantity: 0, desiredQuantity: 0, afterQuantity: 0, emptyState: true });
    const result = await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    expect(result.items).toEqual([]);
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.tx.orderStatusLog.create).not.toHaveBeenCalled();
  });

  it('applies add and remove changes in the same atomic transaction', async () => {
    const harness = buildHarness({ desiredQuantity: 0, afterQuantity: 0, aggregateCount: 0 });
    harness.dto.desiredItems.push({ productId: '32', desiredQuantity: 2 });
    harness.tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([product(32n)]);
    await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    expect(harness.tx.order.create).toHaveBeenCalled();
    expect(harness.tx.orderItem.delete).toHaveBeenCalled();
  });

  it('rejects a stale revision with zero writes and latestState', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    harness.dto.baseRevision = 'dcs2:sha256:' + 'f'.repeat(64);
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CANONICAL_REVISION_CONFLICT', latestState: expect.any(Object) }) });
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('returns an idempotent replay for the same request key and payload hash', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    const payloadHash = payloadHashFor(harness);
    harness.tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ action: 'DINE_IN_CANONICAL_RECONCILED', metadata: { payloadHash } }]);
    const result = await harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto);
    expect(result.idempotentReplay).toBe(true);
    expect(harness.tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects request-key reuse with another payload', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    harness.tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ action: 'DINE_IN_CANONICAL_RECONCILED', metadata: { payloadHash: 'different' } }]);
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'CANONICAL_REQUEST_KEY_CONFLICT' } });
  });

  it('rejects a product that is unavailable', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    harness.tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...product(31n), status: 'SOLD_OUT' }]);
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_AVAILABLE' } });
  });

  it('rejects an invalid lineKey', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    harness.dto.desiredItems = [{ lineKey: `dline:sha256:${'9'.repeat(64)}`, desiredQuantity: 2 }];
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'CANONICAL_LINE_NOT_FOUND' } });
  });

  it('rejects reducing below the locked quantity', async () => {
    const harness = buildHarness({ desiredQuantity: 0, lockedQuantity: 1 });
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'CANONICAL_LINE_LOCKED' } });
    expect(harness.tx.orderItem.delete).not.toHaveBeenCalled();
  });

  it('rolls the whole batch back before any add when another requested line is locked', async () => {
    const harness = buildHarness({ desiredQuantity: 0, lockedQuantity: 1 });
    harness.dto.desiredItems.push({ productId: '32', desiredQuantity: 2 });
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toBeInstanceOf(ConflictException);
    expect(harness.tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects a session containing non-DINE_IN raw orders', async () => {
    const harness = buildHarness({ desiredQuantity: 2, blockers: ['NON_DINE_IN_ORDER'] });
    await expect(harness.service.reconcileDineInCanonicalState(7n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_HAS_NON_DINE_IN_ORDERS' } });
  });

  it('prevents cross-merchant session access before acquiring mutation locks', async () => {
    const harness = buildHarness({ desiredQuantity: 2 });
    harness.prisma.tableSession.findFirst.mockResolvedValueOnce(null);
    await expect(harness.service.reconcileDineInCanonicalState(8n, 3n, 51n, harness.dto)).rejects.toMatchObject({ response: { code: 'TABLE_SESSION_NOT_FOUND' } });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });
});

function buildHarness(options: {
  baseQuantity?: number;
  desiredQuantity?: number;
  afterQuantity?: number;
  rawQuantity?: number;
  lockedQuantity?: number;
  aggregateCount?: number;
  emptyState?: boolean;
  blockers?: string[];
}) {
  const baseQuantity = options.baseQuantity ?? 1;
  const desiredQuantity = options.desiredQuantity ?? 2;
  const afterQuantity = options.afterQuantity ?? desiredQuantity;
  const before = state(baseQuantity, options.lockedQuantity ?? 0, options.blockers ?? [], options.emptyState);
  const after = state(afterQuantity, 0, [], afterQuantity === 0);
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([product(31n)]),
    merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
    order: {
      create: jest.fn().mockResolvedValue({ id: 81n }),
      findFirst: jest.fn().mockResolvedValue({ id: 41n, status: 'ACCEPTED', deliveryFeeVnd: 0n }),
      findUnique: jest.fn().mockResolvedValue({ status: afterQuantity === 0 ? 'CANCELLED' : 'ACCEPTED' }),
      update: jest.fn().mockResolvedValue({ id: 41n }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderItem: {
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { subtotalVnd: afterQuantity > 0 ? BigInt(afterQuantity) * 12_000n : null },
        _count: { id: options.aggregateCount ?? (afterQuantity > 0 ? 1 : 0) },
      }),
    },
    orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 91n }) },
    tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  if (before.items[0]?.rawItems[0]) before.items[0].rawItems[0].quantity = options.rawQuantity ?? baseQuantity;
  const canonical = new DineInCanonicalStateService({} as never);
  jest.spyOn(canonical, 'buildLockedWithClient').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
  const prisma = {
    tableSession: { findFirst: jest.fn().mockResolvedValue({ id: 51n, tableId: 11n }) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const printJobs = {
    enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([]),
    processAutomaticTriggerIds: jest.fn().mockResolvedValue(undefined),
  };
  const creator = { assertValid: jest.fn().mockResolvedValue({ staffRole: 'STAFF' }) };
  const cancellation = { cancel: jest.fn().mockResolvedValue({ id: 92n }) };
  const service = new MerchantOrdersService(
    prisma as never,
    printJobs as never,
    {} as never,
    creator as never,
    cancellation as never,
    canonical,
  );
  const dto: ReconcileDineInCanonicalStateDto = {
    requestKey: 'canonical_request_0001',
    baseRevision: before.revision,
    desiredItems: options.emptyState ? [] : [{ lineKey: before.items[0]!.lineKey, desiredQuantity }],
  };
  return { service, prisma, tx, canonical, dto, before, after };
}

function state(quantity: number, lockedQuantity: number, blockers: string[], empty = false): DineInCanonicalStateInternal {
  const lineKey = `dline:sha256:${'1'.repeat(64)}`;
  return {
    sessionId: '51', tableId: '11', tableNo: 'A01', tableName: null,
    sessionStatus: 'OPEN', revision: `dcs2:sha256:${quantity.toString().padStart(64, '0')}`,
    items: empty ? [] : [{
      lineKey, productId: '31', productNameZh: '鱼香茄子', productNameVi: null, productNameEn: null,
      remark: '', optionSignature: '', unitPriceVnd: '12000', quantity,
      lockedQuantity, adjustableQuantity: quantity - lockedQuantity,
      subtotalVnd: (BigInt(quantity) * 12_000n).toString(), adjustability: lockedQuantity === quantity ? 'LOCKED' : 'RETURN',
      sourceSummary: { staffQuantity: quantity, qrQuantity: 0 },
      rawItems: [{ itemId: 71n, orderId: 41n, orderStatus: 'ACCEPTED', quantity, unitPriceVnd: 12_000n }],
    }],
    totals: { originalAmountVnd: (BigInt(quantity) * 12_000n).toString(), discountPayableRateBps: null, discountAmountVnd: '0', roundingAmountVnd: '0', payableAmountVnd: (BigInt(quantity) * 12_000n).toString() },
    blockers, generatedAt: '2026-08-30T00:00:00.000Z',
  };
}

function product(id: bigint) {
  return { id, name_zh: '鱼香茄子', image_url: null, price_vnd: 12_000n, product_type: 'FOOD', status: 'ON_SALE', deleted_at: null, category_active: 1 };
}

function payloadHashFor(harness: ReturnType<typeof buildHarness>) {
  return canonicalPayloadHash({
    sessionId: '51',
    baseRevision: harness.dto.baseRevision,
    desiredItems: harness.dto.desiredItems.map((item) => ({ desiredQuantity: item.desiredQuantity, lineKey: item.lineKey, productId: null, remark: '' })),
  });
}
