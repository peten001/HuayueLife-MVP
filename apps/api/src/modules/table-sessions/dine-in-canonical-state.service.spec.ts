import type { OrderStatus } from '@prisma/client';
import {
  DineInCanonicalStateService,
  type DineInCanonicalSource,
} from './dine-in-canonical-state.service';

describe('DineInCanonicalStateService builder', () => {
  const service = new DineInCanonicalStateService({} as never);

  it('builds one staff order', () => {
    const state = service.build(source());
    expect(state.items).toEqual([expect.objectContaining({
      productId: '31', quantity: 1, subtotalVnd: '12000',
      sourceSummary: { staffQuantity: 1, qrQuantity: 0 },
    })]);
  });

  it('merges multiple staff add orders with the same semantic line', () => {
    const input = source();
    input.orders.push(order(42n, 'ACCEPTED', 3n));
    input.items.push(item(72n, 42n, { quantity: 2, subtotalVnd: 24_000n }));
    expect(service.build(input).items[0]).toMatchObject({ quantity: 3, subtotalVnd: '36000' });
  });

  it('merges QR and staff sources while preserving source quantities', () => {
    const input = source();
    input.orders.push(order(42n, 'ACCEPTED', null, 99n));
    input.items.push(item(72n, 42n, { quantity: 2, subtotalVnd: 24_000n }));
    expect(service.build(input).items[0]?.sourceSummary).toEqual({ staffQuantity: 1, qrQuantity: 2 });
  });

  it('keeps mixed remarks as separate lines', () => {
    const input = source();
    input.items.push(item(72n, 41n, { remark: '少辣' }));
    expect(service.build(input).items).toHaveLength(2);
  });

  it('keeps different price snapshots as separate lines', () => {
    const input = source();
    input.items.push(item(72n, 41n, { unitPriceVnd: 15_000n, subtotalVnd: 15_000n }));
    expect(service.build(input).items.map((line) => line.unitPriceVnd).sort()).toEqual(['12000', '15000']);
  });

  it('keeps first-active dish order stable and appends a removed then re-added dish', () => {
    const input = source();
    input.items[0]!.createdAt = new Date('2026-08-30T00:00:01.000Z');
    input.orders.push(
      order(42n, 'ACCEPTED', 3n),
      order(43n, 'ACCEPTED', 3n),
      order(44n, 'ACCEPTED', 3n),
    );
    // A was increased later, but its earliest still-positive contribution is
    // unchanged. B's old row is gone and its re-add receives the newest time.
    input.items.push(
      item(72n, 42n, { productId: 32n, productNameZhSnapshot: 'B', productNameZh: 'B', createdAt: new Date('2026-08-30T00:00:02.000Z') }),
      item(73n, 43n, { productId: 31n, productNameZhSnapshot: 'A', productNameZh: 'A', createdAt: new Date('2026-08-30T00:00:03.000Z') }),
      item(74n, 44n, { productId: 33n, productNameZhSnapshot: 'C', productNameZh: 'C', createdAt: new Date('2026-08-30T00:00:04.000Z') }),
    );
    input.items = input.items.filter((entry) => entry.id !== 72n);
    input.items.push(item(75n, 44n, { productId: 32n, productNameZhSnapshot: 'B', productNameZh: 'B', createdAt: new Date('2026-08-30T00:00:05.000Z') }));

    const built = service.build(input);
    expect(built.items.map((line) => line.productNameZh)).toEqual(['鱼香茄子', 'C', 'B']);
    expect(built.items[0]?.quantity).toBe(2);
    expect(built.items.map((line) => line.activeSince)).toEqual([
      input.items[0]!.createdAt.toISOString(),
      '2026-08-30T00:00:04.000Z',
      '2026-08-30T00:00:05.000Z',
    ]);
  });

  it('does not reorder a positive line when its oldest raw contribution is removed', () => {
    const input = source();
    input.items[0]!.createdAt = new Date('2026-08-30T00:00:01.000Z');
    input.orders.push(order(42n, 'ACCEPTED', 3n), order(43n, 'ACCEPTED', 3n));
    input.items.push(
      item(72n, 42n, { productId: 32n, productNameZhSnapshot: 'B', productNameZh: 'B', createdAt: new Date('2026-08-30T00:00:02.000Z') }),
      item(73n, 43n, { productId: 31n, productNameZhSnapshot: 'A', productNameZh: 'A', createdAt: new Date('2026-08-30T00:00:03.000Z') }),
    );
    input.statusLogs.push(
      additionLog(101n, 41n, '2026-08-30T00:00:01.000Z', 31n, '鱼香茄子'),
      additionLog(102n, 42n, '2026-08-30T00:00:02.000Z', 32n, 'B'),
      additionLog(103n, 43n, '2026-08-30T00:00:03.000Z', 31n, 'A'),
    );

    input.items = input.items.filter((entry) => entry.id !== 71n);
    const built = service.build(input);

    expect(built.items.map((line) => line.productNameZh)).toEqual(['A', 'B']);
    expect(built.items[0]).toMatchObject({
      quantity: 1,
      activeSince: '2026-08-30T00:00:01.000Z',
    });
  });

  it('starts a new ordering epoch only after aggregate zero then re-add', () => {
    const input = source();
    const lineKey = service.build(input).items[0]!.lineKey;
    input.orders.push(order(42n, 'ACCEPTED', 3n));
    input.items.push(item(72n, 42n, {
      productId: 32n,
      productNameZhSnapshot: 'B',
      productNameZh: 'B',
      createdAt: new Date('2026-08-30T00:00:02.000Z'),
    }));
    input.statusLogs.push(
      additionLog(101n, 41n, '2026-08-30T00:00:01.000Z', 31n, '鱼香茄子'),
      additionLog(102n, 42n, '2026-08-30T00:00:02.000Z', 32n, 'B'),
      {
        id: 103n,
        orderId: 41n,
        action: 'DINE_IN_CANONICAL_RECONCILED',
        createdAt: new Date('2026-08-30T00:00:04.000Z'),
        metadata: { lineChanges: [{ lineKey, beforeQuantity: 1, afterQuantity: 0 }] },
      },
      {
        id: 104n,
        orderId: 41n,
        action: 'DINE_IN_CANONICAL_RECONCILED',
        createdAt: new Date('2026-08-30T00:00:05.000Z'),
        metadata: { lineChanges: [{ lineKey, beforeQuantity: 0, afterQuantity: 1 }] },
      },
    );
    input.items[0]!.createdAt = new Date('2026-08-30T00:00:05.000Z');

    const built = service.build(input);
    expect(built.items.map((line) => line.productNameZh)).toEqual(['B', '鱼香茄子']);
    expect(built.items[1]?.activeSince).toBe('2026-08-30T00:00:05.000Z');
  });

  it('marks accepted items as RETURN', () => {
    expect(service.build(source()).items[0]?.adjustability).toBe('RETURN');
  });

  it('marks pending items as DECREASE', () => {
    expect(service.build(source('PENDING_ACCEPTANCE')).items[0]?.adjustability).toBe('DECREASE');
  });

  it('excludes raw cancelled orders after emptying', () => {
    const input = source('CANCELLED');
    expect(service.build(input).items).toEqual([]);
  });

  it('represents an OPEN session with zero items', () => {
    const input = source();
    input.orders = [];
    input.items = [];
    expect(service.build(input)).toMatchObject({ sessionStatus: 'OPEN', items: [], totals: { payableAmountVnd: '0' } });
  });

  it('uses historical identity for a deleted product', () => {
    const input = source();
    input.items[0]!.productId = null;
    input.items[0]!.productNameZh = null;
    const state = service.build(input);
    expect(state.items[0]).toMatchObject({ productId: null, productNameZh: '鱼香茄子', adjustability: 'RETURN' });
    expect(state.items[0]?.lineKey).toMatch(/^dline:sha256:/);
  });

  it('calculates discount from canonical item amount', () => {
    const input = source();
    input.session.discountPayableRateBps = 9_000;
    input.session.discountAmountVnd = 1_200n;
    input.session.discountAppliedByStaffId = 3n;
    expect(service.build(input).totals).toMatchObject({ discountAmountVnd: '1200', payableAmountVnd: '10800' });
  });

  it('calculates rounding from canonical discounted amount', () => {
    const input = source();
    input.items[0]!.unitPriceVnd = 12_345n;
    input.items[0]!.subtotalVnd = 12_345n;
    input.orders[0]!.itemAmountVnd = 12_345n;
    input.orders[0]!.totalAmountVnd = 12_345n;
    input.session.roundingAppliedByStaffId = 3n;
    input.session.roundingAmountVnd = 345n;
    expect(service.build(input).totals).toMatchObject({ roundingAmountVnd: '2345', payableAmountVnd: '10000' });
  });

  it('produces a stable deterministic revision when raw facts are reordered', () => {
    const input = source();
    input.orders.push(order(42n, 'ACCEPTED', 3n));
    input.items.push(item(72n, 42n));
    const first = service.build(input).revision;
    const second = service.build({ ...input, orders: [...input.orders].reverse(), items: [...input.items].reverse() }).revision;
    expect(second).toBe(first);
  });

  it('produces the same revision for the same semantic state', () => {
    expect(service.build(source()).revision).toBe(service.build(source()).revision);
  });

  it('changes revision when a semantic quantity changes', () => {
    const before = source();
    const after = source();
    after.items[0]!.quantity = 2;
    after.items[0]!.subtotalVnd = 24_000n;
    expect(service.build(after).revision).not.toBe(service.build(before).revision);
  });

  it('does not include generatedAt or unrelated telemetry timestamps in revision', () => {
    const input = source() as DineInCanonicalSource & { telemetryUpdatedAt?: Date };
    const before = service.build(input).revision;
    input.telemetryUpdatedAt = new Date('2030-01-01T00:00:00.000Z');
    expect(service.build(input).revision).toBe(before);
  });
});

function source(status: OrderStatus = 'ACCEPTED'): DineInCanonicalSource {
  return {
    session: {
      id: 51n,
      merchantId: 7n,
      tableId: 11n,
      status: 'OPEN',
      openTableId: 11n,
      tableNo: 'A01',
      tableName: null,
      openedAt: new Date('2026-08-30T00:00:00.000Z'),
      discountPayableRateBps: null,
      discountAmountVnd: 0n,
      discountAppliedByStaffId: null,
      roundingAmountVnd: 0n,
      roundingAppliedByStaffId: null,
    },
    orders: [order(41n, status, 3n)],
    items: [item(71n, 41n)],
    statusLogs: [],
  };
}

function additionLog(
  id: bigint,
  orderId: bigint,
  createdAt: string,
  productId: bigint,
  productNameSnapshot: string,
) {
  return {
    id,
    orderId,
    action: 'MERCHANT_ADD_ITEMS',
    createdAt: new Date(createdAt),
    metadata: {
      items: [{
        productId: productId.toString(),
        productNameSnapshot,
        quantity: 1,
        remark: null,
        unitPriceVnd: '12000',
        subtotalVnd: '12000',
      }],
    },
  };
}

function order(id: bigint, status: OrderStatus, staffId: bigint | null, userId: bigint | null = null) {
  return {
    id,
    status,
    orderType: 'DINE_IN' as const,
    userId,
    createdByStaffId: staffId,
    itemAmountVnd: 12_000n,
    deliveryFeeVnd: 0n,
    totalAmountVnd: 12_000n,
    createdAt: new Date(Date.UTC(2026, 7, 30, 0, 0, Number(id))),
  };
}

function item(id: bigint, orderId: bigint, overrides: Partial<DineInCanonicalSource['items'][number]> = {}) {
  return {
    id,
    orderId,
    productId: 31n,
    productNameZhSnapshot: '鱼香茄子',
    productNameZh: '鱼香茄子',
    productNameVi: 'Cà tím xào',
    productNameEn: 'Eggplant',
    remark: null,
    unitPriceVnd: 12_000n,
    quantity: 1,
    subtotalVnd: 12_000n,
    createdAt: new Date(Date.UTC(2026, 7, 30, 0, 0, Number(id))),
    ...overrides,
  };
}
