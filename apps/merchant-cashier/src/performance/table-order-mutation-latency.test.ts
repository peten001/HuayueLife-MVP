import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CashierMenuProduct, MerchantOrderMutationResult } from '@/types';

const apiMocks = vi.hoisted(() => ({ createMerchantTableOrder: vi.fn() }));
vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  createMerchantTableOrder: apiMocks.createMerchantTableOrder,
}));

import { useTableOrderMutationController, type TableOrderDecreaseExecutionResult } from '@/composables';
import { productDirectMergeKey } from '@/domain';

const product: CashierMenuProduct = {
  id: 'product-1', categoryId: 'category-1', nameZh: '牛肉粉', priceVnd: '60000', sortOrder: 1,
  status: 'ON_SALE', productType: 'FOOD',
};

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function mutationResult(): MerchantOrderMutationResult {
  return {
    order: null,
    session: {
      id: 'session-1', sessionNo: 'S-1', merchantId: 'merchant-1', tableId: 'table-1', tableNo: 'A01',
      status: 'OPEN', openedAt: '2026-08-28T00:00:00.000Z', orderCount: 1, itemCount: 1,
      totalAmountVnd: '60000', pendingOrderCount: 0, unfinishedOrderCount: 1, orders: [],
    },
  };
}

function p95(samples: number[]) {
  return [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1] || 0;
}

describe('Cashier table mutation interaction latency', () => {
  it('keeps five right-plus, menu-plus and right-minus feedback samples below 50ms p95', () => {
    const addRequest = deferred<MerchantOrderMutationResult>();
    const decreaseRequest = deferred<TableOrderDecreaseExecutionResult>();
    apiMocks.createMerchantTableOrder.mockReset().mockReturnValue(addRequest.promise);
    const executeDecrease = vi.fn().mockReturnValue(decreaseRequest.promise);
    const tableId = ref('table-1');
    const controller = useTableOrderMutationController({
      tableId: () => tableId.value,
      sessionId: () => 'session-1',
      disabled: () => false,
      orderableProducts: () => [product],
      executeDecrease,
      onResult: () => undefined,
      onFailure: () => undefined,
    });

    const rightPlus: number[] = [];
    const menuPlus: number[] = [];
    const rightMinus: number[] = [];
    const mergeKey = productDirectMergeKey(product.id);
    for (let index = 0; index < 5; index += 1) {
      const beforeRightPlus = performance.now();
      controller.addProduct(product.id, `right-${index}`, undefined, mergeKey);
      expect(controller.pendingAddQuantities.value[product.id]).toBe(index * 2 + 1);
      rightPlus.push(performance.now() - beforeRightPlus);

      const beforeMenuPlus = performance.now();
      controller.addProduct(product.id, `menu-${index}`, undefined, mergeKey);
      expect(controller.pendingAddQuantities.value[product.id]).toBe(index * 2 + 2);
      menuPlus.push(performance.now() - beforeMenuPlus);
    }

    for (let index = 0; index < 5; index += 1) {
      const isolated = useTableOrderMutationController({
        tableId: () => `table-minus-${index}`,
        sessionId: () => `session-minus-${index}`,
        disabled: () => false,
        orderableProducts: () => [product],
        executeDecrease,
        onResult: () => undefined,
        onFailure: () => undefined,
      });
      const mergeKey = `minus-${index}`;
      const beforeMinus = performance.now();
      isolated.decreaseProduct(product.id, mergeKey);
      expect(isolated.pendingDecreaseMergeKeys.value.has(mergeKey)).toBe(true);
      rightMinus.push(performance.now() - beforeMinus);
    }

    const metrics = {
      rightPlusP95Ms: p95(rightPlus),
      menuPlusP95Ms: p95(menuPlus),
      rightMinusP95Ms: p95(rightMinus),
    };
    console.info('CASHIER_MUTATION_LATENCY', JSON.stringify(metrics));
    expect(metrics.rightPlusP95Ms).toBeLessThan(50);
    expect(metrics.menuPlusP95Ms).toBeLessThan(50);
    expect(metrics.rightMinusP95Ms).toBeLessThan(50);
    expect(controller.intents.value).toHaveLength(2);
    addRequest.resolve(mutationResult());
    decreaseRequest.resolve({ result: mutationResult(), appliedQuantity: 1 });
  });

  it.each([50, 200, 500, 1_000])('keeps optimistic feedback below 50ms with a %dms response', async (delayMs) => {
    apiMocks.createMerchantTableOrder.mockReset().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(mutationResult()), delayMs);
    }));
    const controller = useTableOrderMutationController({
      tableId: () => 'table-latency',
      sessionId: () => 'session-latency',
      disabled: () => false,
      orderableProducts: () => [product],
      executeDecrease: vi.fn(),
      onResult: () => undefined,
      onFailure: () => undefined,
    });
    const startedAt = performance.now();
    controller.addProduct(product.id);
    const feedbackMs = performance.now() - startedAt;
    expect(controller.pendingAddQuantities.value[product.id]).toBe(1);
    expect(feedbackMs).toBeLessThan(50);
    await expect(controller.flush()).resolves.toBe(true);
  });
});
