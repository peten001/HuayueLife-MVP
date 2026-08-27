import { describe, expect, it } from 'vitest';
import type { CashierOrderingDraftLine, TableSessionOrder } from '@/types';
import {
  buildCanonicalItemMergeKey,
  buildCanonicalTableBillLines,
  productDirectMergeKey,
  stabilizeCanonicalTableBillLineOrder,
} from './canonical-order-lines';

const product = {
  id: 'product-1',
  categoryId: 'category-1',
  nameZh: '牛肉粉',
  priceVnd: '60000',
  sortOrder: 1,
  status: 'ON_SALE' as const,
  productType: 'FOOD' as const,
};

function order(id: string, itemId: string, quantity = 1, extra: Record<string, unknown> = {}): TableSessionOrder {
  return {
    id,
    orderNo: id,
    status: 'ACCEPTED',
    createdAt: '2026-08-27T00:00:00.000Z',
    itemAmountVnd: String(60000 * quantity),
    deliveryFeeVnd: '0',
    totalAmountVnd: String(60000 * quantity),
    items: [{
      id: itemId,
      productId: product.id,
      productNameZhSnapshot: product.nameZh,
      quantity,
      unitPriceVnd: product.priceVnd,
      subtotalVnd: String(60000 * quantity),
      ...extra,
    }],
  };
}

function draft(quantity: number, extra: Partial<CashierOrderingDraftLine> = {}): CashierOrderingDraftLine {
  return {
    lineId: 'product:product-1',
    mergeKey: productDirectMergeKey(product.id),
    product,
    quantity,
    ...extra,
  };
}

function productOrder(
  productId: string,
  createdAt: string,
  suffix: string,
  quantity = 1,
  extra: Record<string, unknown> = {},
) {
  const value = order(`order-${suffix}`, `item-${suffix}`, quantity, extra);
  value.createdAt = createdAt;
  value.items[0]!.productId = productId;
  value.items[0]!.productNameZhSnapshot = `菜品 ${productId}`;
  return value;
}

function pendingProduct(
  productId: string,
  firstAddedAt: string,
  firstAddedSequence: number,
  extra: Partial<CashierOrderingDraftLine> = {},
): CashierOrderingDraftLine {
  return {
    lineId: `product:${productId}`,
    mergeKey: productDirectMergeKey(productId),
    product: { ...product, id: productId, nameZh: `菜品 ${productId}` },
    quantity: 1,
    firstAddedAt,
    firstAddedSequence,
    ...extra,
  };
}

function productIds(lines: ReturnType<typeof buildCanonicalTableBillLines>) {
  return lines.map((line) => line.item?.productId || line.product?.id);
}

describe('canonical table bill lines', () => {
  it('merges five committed clicks for the same business identity into one quantity-five line', () => {
    const orders = Array.from({ length: 5 }, (_, index) => order(`order-${index}`, `item-${index}`));
    const [line] = buildCanonicalTableBillLines(orders);

    expect(buildCanonicalTableBillLines(orders)).toHaveLength(1);
    expect(line).toMatchObject({ committedQuantity: 5, pendingQuantity: 0, quantity: 5, subtotalVnd: '300000' });
    expect(line?.committedEntries).toHaveLength(5);
  });

  it('merges committed and pending quantities without changing the underlying committed entries', () => {
    const [line] = buildCanonicalTableBillLines([order('order-1', 'item-1', 2)], [draft(3)]);

    expect(line).toMatchObject({ committedQuantity: 2, pendingQuantity: 3, quantity: 5, subtotalVnd: '300000' });
    expect(line?.committedEntries).toHaveLength(1);
    expect(line?.draftLines).toHaveLength(1);
  });

  it('keeps distinct products, remarks, variants and add-on combinations in separate rows', () => {
    const plain = order('order-plain', 'item-plain');
    const lessSalt = order('order-less-salt', 'item-less-salt', 1, { remark: ' 少盐 ' });
    const spicy = order('order-spicy', 'item-spicy', 1, { remark: '加辣' });
    const large = order('order-large', 'item-large', 1, { variantId: 'large' });
    const addonsA = order('order-addons-a', 'item-addons-a', 1, { addons: [{ id: 'egg' }, { id: 'beef' }] });
    const addonsB = order('order-addons-b', 'item-addons-b', 1, { addons: [{ id: 'beef' }, { id: 'egg' }] });
    const otherProduct = order('order-other', 'item-other');
    otherProduct.items[0]!.productId = 'product-2';

    const lines = buildCanonicalTableBillLines([plain, lessSalt, spicy, large, addonsA, addonsB, otherProduct]);

    expect(lines).toHaveLength(6);
    expect(lines.find((line) => line.quantity === 2)?.committedEntries).toHaveLength(2);
    expect(buildCanonicalItemMergeKey(lessSalt.items[0]!)).not.toBe(buildCanonicalItemMergeKey(spicy.items[0]!));
  });

  it('never merges historical rows by dish name when product identity is absent', () => {
    const first = order('order-a', 'historical-a');
    const second = order('order-b', 'historical-b');
    first.items[0]!.productId = null;
    second.items[0]!.productId = null;

    expect(buildCanonicalTableBillLines([first, second])).toHaveLength(2);
  });

  it('keeps the canonical identity stable when raw order facts are reordered', () => {
    const first = order('order-a', 'item-a', 2);
    const second = order('order-b', 'item-b', 3);
    const before = buildCanonicalTableBillLines([first, second]);
    const after = buildCanonicalTableBillLines([second, first]);

    expect(before.map(({ mergeKey, quantity }) => ({ mergeKey, quantity })))
      .toEqual(after.map(({ mergeKey, quantity }) => ({ mergeKey, quantity })));
  });

  it('keeps A, B and C in first-added order through repeated increments, D insertion and refresh reordering', () => {
    const a = productOrder('A', '2026-08-27T00:00:01.000Z', 'a');
    const b = productOrder('B', '2026-08-27T00:00:02.000Z', 'b');
    const c = productOrder('C', '2026-08-27T00:00:03.000Z', 'c');
    const bPlus = productOrder('B', '2026-08-27T00:00:04.000Z', 'b-plus');
    const aPlus = productOrder('A', '2026-08-27T00:00:05.000Z', 'a-plus');
    const cPlus = productOrder('C', '2026-08-27T00:00:06.000Z', 'c-plus');
    const d = productOrder('D', '2026-08-27T00:00:07.000Z', 'd');

    expect(productIds(buildCanonicalTableBillLines([c, b, a]))).toEqual(['A', 'B', 'C']);

    const afterB = buildCanonicalTableBillLines([bPlus, c, a, b]);
    expect(productIds(afterB)).toEqual(['A', 'B', 'C']);
    expect(afterB.find((line) => line.item?.productId === 'B')?.quantity).toBe(2);

    const afterA = buildCanonicalTableBillLines([aPlus, bPlus, c, b, a]);
    expect(productIds(afterA)).toEqual(['A', 'B', 'C']);

    const afterC = buildCanonicalTableBillLines([cPlus, a, bPlus, c, aPlus, b]);
    expect(productIds(afterC)).toEqual(['A', 'B', 'C']);

    const afterD = buildCanonicalTableBillLines([d, aPlus, cPlus, b, a, bPlus, c]);
    expect(productIds(afterD)).toEqual(['A', 'B', 'C', 'D']);

    const refreshed = buildCanonicalTableBillLines([cPlus, d, bPlus, a, c, aPlus, b]);
    expect(productIds(refreshed)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps committed anchors when pending quantities merge into existing rows', () => {
    const a = productOrder('A', '2026-08-27T00:00:01.000Z', 'a');
    const b = productOrder('B', '2026-08-27T00:00:02.000Z', 'b');
    const pendingA = pendingProduct('A', '2026-08-27T00:00:04.000Z', 1);
    const pendingC = pendingProduct('C', '2026-08-27T00:00:03.000Z', 0);

    const lines = buildCanonicalTableBillLines([b, a], [pendingC, pendingA]);

    expect(productIds(lines)).toEqual(['A', 'B', 'C']);
    expect(lines[0]).toMatchObject({ firstAddedSource: 'committed', quantity: 2 });
  });

  it('uses the earliest pending creation anchor for a pure pending canonical group', () => {
    const later = pendingProduct('A', '2026-08-27T00:00:05.000Z', 5);
    const earlier = pendingProduct('A', '2026-08-27T00:00:04.000Z', 4, { lineId: 'product:A:earlier' });
    const b = pendingProduct('B', '2026-08-27T00:00:04.500Z', 6);

    const lines = buildCanonicalTableBillLines([], [later, b, earlier]);

    expect(productIds(lines)).toEqual(['A', 'B']);
    expect(lines[0]).toMatchObject({ firstAddedAt: earlier.firstAddedAt, quantity: 2 });
  });

  it('keeps specification groups in first-added order while merging later increments', () => {
    const plain = productOrder('A', '2026-08-27T00:00:01.000Z', 'plain');
    const spicy = productOrder('A', '2026-08-27T00:00:02.000Z', 'spicy', 1, { variantId: 'spicy' });
    const b = productOrder('B', '2026-08-27T00:00:03.000Z', 'b');
    const plainPlus = productOrder('A', '2026-08-27T00:00:04.000Z', 'plain-plus');

    const lines = buildCanonicalTableBillLines([plainPlus, b, spicy, plain]);

    expect(lines.map((line) => line.mergeKey)).toEqual([
      buildCanonicalItemMergeKey(plain.items[0]!),
      buildCanonicalItemMergeKey(spicy.items[0]!),
      buildCanonicalItemMergeKey(b.items[0]!),
    ]);
    expect(lines[0]?.quantity).toBe(2);
  });

  it('appends a removed product when it is added again as a new pending group', () => {
    const b = productOrder('B', '2026-08-27T00:00:02.000Z', 'b');
    const c = productOrder('C', '2026-08-27T00:00:03.000Z', 'c');
    const readdedA = pendingProduct('A', '2026-08-27T00:00:08.000Z', 8);

    expect(productIds(buildCanonicalTableBillLines([c, b], [readdedA])))
      .toEqual(['B', 'C', 'A']);
  });

  it('preserves A B C D while decreases replace or remove the earliest surviving source fact', () => {
    const a = productOrder('A', '2026-08-27T00:00:01.000Z', 'a', 2);
    const b = productOrder('B', '2026-08-27T00:00:02.000Z', 'b', 4);
    const c = productOrder('C', '2026-08-27T00:00:03.000Z', 'c', 2);
    const d = productOrder('D', '2026-08-27T00:00:04.000Z', 'd');
    const bPlus = productOrder('B', '2026-08-27T00:00:05.000Z', 'b-plus');
    const initial = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([d, bPlus, c, b, a]),
    );
    const initialOrder = initial.map((line) => line.mergeKey);

    expect(productIds(initial)).toEqual(['A', 'B', 'C', 'D']);

    const bFour = productOrder('B', b.createdAt, 'b', 3);
    const afterBMinus = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([c, bPlus, a, d, bFour]),
      initialOrder,
    );
    expect(productIds(afterBMinus)).toEqual(['A', 'B', 'C', 'D']);
    expect(afterBMinus.find((line) => line.item?.productId === 'B')?.quantity).toBe(4);

    const bThree = productOrder('B', b.createdAt, 'b', 2);
    const afterRepeatedBMinus = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([bPlus, d, c, bThree, a]),
      afterBMinus.map((line) => line.mergeKey),
    );
    expect(productIds(afterRepeatedBMinus)).toEqual(['A', 'B', 'C', 'D']);
    expect(afterRepeatedBMinus.find((line) => line.item?.productId === 'B')?.quantity).toBe(3);

    const aMinus = productOrder('A', a.createdAt, 'a', 1);
    const cMinus = productOrder('C', c.createdAt, 'c', 1);
    const afterOtherMinuses = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([bPlus, d, cMinus, bThree, aMinus]),
      afterRepeatedBMinus.map((line) => line.mergeKey),
    );
    expect(productIds(afterOtherMinuses)).toEqual(['A', 'B', 'C', 'D']);

    const afterRefresh = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([d, aMinus, bThree, cMinus, bPlus]),
      afterOtherMinuses.map((line) => line.mergeKey),
    );
    expect(productIds(afterRefresh)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('drops a zeroed merge key and appends it after a later re-add', () => {
    const a = productOrder('A', '2026-08-27T00:00:01.000Z', 'a');
    const b = productOrder('B', '2026-08-27T00:00:02.000Z', 'b');
    const c = productOrder('C', '2026-08-27T00:00:03.000Z', 'c');
    const d = productOrder('D', '2026-08-27T00:00:04.000Z', 'd');
    const initial = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([d, c, b, a]),
    );
    const afterZero = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([d, c, a]),
      initial.map((line) => line.mergeKey),
    );
    const readdedB = pendingProduct('B', '2026-08-27T00:00:08.000Z', 8);
    const afterReadd = stabilizeCanonicalTableBillLineOrder(
      buildCanonicalTableBillLines([d, c, a], [readdedB]),
      afterZero.map((line) => line.mergeKey),
    );

    expect(productIds(afterZero)).toEqual(['A', 'C', 'D']);
    expect(productIds(afterReadd)).toEqual(['A', 'C', 'D', 'B']);
  });
});
