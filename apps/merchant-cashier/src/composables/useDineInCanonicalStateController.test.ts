import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import type { CashierMenuProduct, DineInCanonicalState } from '@/types';
import { useDineInCanonicalStateController } from './useDineInCanonicalStateController';

const apiMocks = vi.hoisted(() => ({
  getDineInCanonicalState: vi.fn(),
  reconcileDineInCanonicalState: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getDineInCanonicalState: apiMocks.getDineInCanonicalState,
  reconcileDineInCanonicalState: apiMocks.reconcileDineInCanonicalState,
}));

describe('useDineInCanonicalStateController', () => {
  beforeEach(() => {
    apiMocks.getDineInCanonicalState.mockReset();
    apiMocks.reconcileDineInCanonicalState.mockReset();
  });

  it('loads the server canonical state before presenting a table bill', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    const controller = createController();
    await controller.load(true);
    expect(controller.presentedState.value?.revision).toBe(state(1).revision);
    expect(controller.productQuantities.value).toEqual({ 'product-1': 1 });
  });

  it('updates + and - quantities synchronously without a global blocker', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    const request = deferred<DineInCanonicalState>();
    apiMocks.reconcileDineInCanonicalState.mockReturnValue(request.promise);
    const controller = createController();
    await controller.load(true);
    controller.addProduct('product-1');
    expect(controller.productQuantities.value['product-1']).toBe(2);
    expect(controller.mutationLocked.value).toBe(false);
    controller.decreaseLine(controller.presentedState.value!.items[0]!);
    expect(controller.productQuantities.value['product-1']).toBe(1);
    expect(controller.mutationLocked.value).toBe(false);
    request.resolve(state(1));
    await controller.flush();
  });

  it('coalesces rapid +10 into one full desired-state batch', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    apiMocks.reconcileDineInCanonicalState.mockResolvedValue(state(11));
    const controller = createController();
    await controller.load(true);
    for (let index = 0; index < 10; index += 1) controller.addProduct('product-1');
    expect(controller.productQuantities.value['product-1']).toBe(11);
    await controller.flush();
    expect(apiMocks.reconcileDineInCanonicalState).toHaveBeenCalledTimes(1);
    expect(apiMocks.reconcileDineInCanonicalState.mock.calls[0]?.[1].desiredItems).toContainEqual(expect.objectContaining({ desiredQuantity: 11 }));
  });

  it('keeps the OPEN session context when the last item changes 1 to 0', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    apiMocks.reconcileDineInCanonicalState.mockResolvedValue(state(0));
    const controller = createController();
    await controller.load(true);
    controller.decreaseLine(controller.presentedState.value!.items[0]!);
    expect(controller.presentedState.value?.sessionStatus).toBe('OPEN');
    expect(controller.presentedState.value?.items).toEqual([]);
    await controller.flush();
    expect(controller.canonicalState.value?.sessionStatus).toBe('OPEN');
    expect(controller.canonicalState.value?.items).toEqual([]);
  });

  it('auto-rebases a non-overlapping line after a revision conflict', async () => {
    const initial = twoLineState(1, 1);
    const latest = twoLineState(1, 2);
    const final = twoLineState(2, 2);
    apiMocks.getDineInCanonicalState.mockResolvedValue(initial);
    apiMocks.reconcileDineInCanonicalState
      .mockRejectedValueOnce(conflict(latest))
      .mockResolvedValueOnce(final);
    const confirm = vi.fn();
    const controller = createController(confirm);
    await controller.load(true);
    controller.increaseLine(controller.presentedState.value!.items[0]!);
    await controller.flush();
    expect(confirm).not.toHaveBeenCalled();
    expect(apiMocks.reconcileDineInCanonicalState).toHaveBeenCalledTimes(2);
    expect(controller.productQuantities.value).toEqual({ 'product-1': 2, 'product-2': 2 });
  });

  it('never silently overwrites a same-line conflict', async () => {
    const initial = state(1);
    const latest = state(3);
    apiMocks.getDineInCanonicalState.mockResolvedValue(initial);
    apiMocks.reconcileDineInCanonicalState.mockRejectedValueOnce(conflict(latest));
    const confirm = vi.fn().mockReturnValue(false);
    const controller = createController(confirm);
    await controller.load(true);
    controller.addProduct('product-1');
    await controller.flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(apiMocks.reconcileDineInCanonicalState).toHaveBeenCalledTimes(1);
    expect(controller.productQuantities.value['product-1']).toBe(3);
  });

  it('retains the exact request key and payload for a true uncertain retry', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    apiMocks.reconcileDineInCanonicalState
      .mockRejectedValueOnce(new CashierApiError({ message: 'timeout', code: 'REQUEST_ABORTED' }))
      .mockResolvedValueOnce(state(2));
    const controller = createController();
    await controller.load(true);
    controller.addProduct('product-1');
    await waitUntil(() => Boolean(controller.uncertainBatch.value));
    const firstInput = apiMocks.reconcileDineInCanonicalState.mock.calls[0]?.[1];
    await controller.retryUncertain();
    expect(apiMocks.reconcileDineInCanonicalState.mock.calls[1]?.[1]).toEqual(firstInput);
    expect(controller.productQuantities.value['product-1']).toBe(2);
  });

  it('rolls back a definitively unavailable product without leaving a pending badge', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(0));
    apiMocks.reconcileDineInCanonicalState.mockRejectedValue(new CashierApiError({ message: 'sold out', status: 409, code: 'PRODUCT_NOT_AVAILABLE' }));
    const controller = createController();
    await controller.load(true);
    controller.addProduct('product-1');
    expect(controller.productQuantities.value['product-1']).toBe(1);
    await controller.flush();
    expect(controller.productQuantities.value['product-1']).toBeUndefined();
    expect(controller.mutationLocked.value).toBe(false);
  });

  it('does not refetch catalog or bootstrap tables for a quantity mutation', async () => {
    apiMocks.getDineInCanonicalState.mockResolvedValue(state(1));
    apiMocks.reconcileDineInCanonicalState.mockResolvedValue(state(2));
    const controller = createController();
    await controller.load(true);
    controller.addProduct('product-1');
    await controller.flush();
    expect(apiMocks.getDineInCanonicalState).toHaveBeenCalledTimes(1);
  });
});

function createController(confirmSameLineConflict = vi.fn().mockReturnValue(true)) {
  return useDineInCanonicalStateController({
    sessionId: () => 'session-1',
    disabled: () => false,
    products: () => products,
    confirmSameLineConflict,
  });
}

const products: CashierMenuProduct[] = [
  { id: 'product-1', categoryId: 'category-1', nameZh: '牛肉粉', nameVi: 'Phở bò', nameEn: 'Beef pho', priceVnd: '60000', status: 'ON_SALE', sortOrder: 1, productType: 'FOOD' },
  { id: 'product-2', categoryId: 'category-1', nameZh: '米粉', nameVi: 'Bún', nameEn: 'Noodles', priceVnd: '40000', status: 'ON_SALE', sortOrder: 2, productType: 'FOOD' },
];

function state(quantity: number): DineInCanonicalState {
  return canonicalState([{ product: products[0]!, quantity }]);
}

function twoLineState(first: number, second: number) {
  return canonicalState([{ product: products[0]!, quantity: first }, { product: products[1]!, quantity: second }]);
}

function canonicalState(lines: Array<{ product: CashierMenuProduct; quantity: number }>): DineInCanonicalState {
  const items = lines.filter(({ quantity }) => quantity > 0).map(({ product, quantity }, index) => ({
    lineKey: `dline:sha256:${String(index + 1).repeat(64)}`,
    productId: product.id, productNameZh: product.nameZh, productNameVi: product.nameVi, productNameEn: product.nameEn,
    remark: '', optionSignature: '', unitPriceVnd: product.priceVnd, quantity, lockedQuantity: 0, adjustableQuantity: quantity,
    subtotalVnd: (BigInt(product.priceVnd) * BigInt(quantity)).toString(), adjustability: 'RETURN' as const,
    sourceSummary: { staffQuantity: quantity, qrQuantity: 0 },
  }));
  const total = items.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n).toString();
  return {
    sessionId: 'session-1', tableId: 'table-1', tableNo: 'A01', tableName: null, sessionStatus: 'OPEN',
    revision: `dcs2:sha256:${lines.map(({ quantity }) => quantity).join('').padStart(64, '0')}`,
    items,
    totals: { originalAmountVnd: total, discountPayableRateBps: null, discountAmountVnd: '0', roundingAmountVnd: '0', payableAmountVnd: total },
    blockers: [], generatedAt: '2026-08-30T00:00:00.000Z',
  };
}

function conflict(latestState: DineInCanonicalState) {
  return new CashierApiError({ message: 'revision conflict', status: 409, code: 'CANONICAL_REVISION_CONFLICT', details: { latestState } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 20; index += 1) {
    await nextTick();
    await Promise.resolve();
    if (predicate()) return;
  }
  throw new Error('condition not reached');
}
