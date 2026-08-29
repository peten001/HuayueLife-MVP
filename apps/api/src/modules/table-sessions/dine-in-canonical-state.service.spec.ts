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
      discountPayableRateBps: null,
      discountAmountVnd: 0n,
      discountAppliedByStaffId: null,
      roundingAmountVnd: 0n,
      roundingAppliedByStaffId: null,
    },
    orders: [order(41n, status, 3n)],
    items: [item(71n, 41n)],
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
    ...overrides,
  };
}
