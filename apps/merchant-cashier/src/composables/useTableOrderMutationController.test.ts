import { nextTick, ref } from 'vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import type { CashierMenuProduct, MerchantOrderMutationResult } from '@/types';

const apiMocks = vi.hoisted(() => ({ createMerchantTableOrder: vi.fn() }));
vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  createMerchantTableOrder: apiMocks.createMerchantTableOrder,
}));

import { useTableOrderMutationController, type TableOrderDecreaseExecution } from './useTableOrderMutationController';

const category = {
  id: 'category-1', nameZh: '主食', sortOrder: 1, isActive: true,
};
const product: CashierMenuProduct = {
  id: 'product-1', categoryId: category.id, nameZh: '牛肉粉', priceVnd: '60000', sortOrder: 1,
  status: 'ON_SALE', productType: 'FOOD', category,
};
const secondProduct: CashierMenuProduct = {
  ...product, id: 'product-2', nameZh: '酸辣蕨根粉', priceVnd: '48000',
};

function result(sequence = 1, selectedProduct = product): MerchantOrderMutationResult {
  return {
    order: null,
    session: {
      id: 'session-1', sessionNo: 'S-1', merchantId: 'merchant-1', tableId: 'table-1', tableNo: 'A01',
      status: 'OPEN', openedAt: '2026-08-28T00:00:00.000Z', orderCount: sequence, itemCount: sequence,
      totalAmountVnd: String(sequence * Number(selectedProduct.priceVnd)), pendingOrderCount: 0,
      unfinishedOrderCount: sequence, orders: [],
    },
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function flush() {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
}

function setup(options: {
  sessionId?: string;
  executeDecrease?: (input: TableOrderDecreaseExecution) => Promise<MerchantOrderMutationResult>;
} = {}) {
  const tableId = ref('table-1');
  const sessionId = ref(options.sessionId ?? 'session-1');
  const products = ref([product, secondProduct]);
  const applied: Array<{ result: MerchantOrderMutationResult; kind: string }> = [];
  const failures: Array<{ error: unknown; kind: string }> = [];
  const controller = useTableOrderMutationController({
    tableId: () => tableId.value,
    sessionId: () => sessionId.value,
    disabled: () => false,
    orderableProducts: () => products.value,
    executeDecrease: options.executeDecrease || vi.fn().mockResolvedValue(result()),
    onResult: (next, intent) => { applied.push({ result: next, kind: intent?.kind || 'OPEN' }); },
    onFailure: (error, intent) => { failures.push({ error, kind: intent?.kind || 'OPEN' }); },
  });
  return { controller, tableId, sessionId, products, applied, failures };
}

describe('useTableOrderMutationController', () => {
  beforeEach(() => apiMocks.createMerchantTableOrder.mockReset());

  it('owns the right-panel add while the menu workspace is unmounted and applies the returned snapshot', async () => {
    apiMocks.createMerchantTableOrder.mockResolvedValueOnce(result());
    const { controller, applied } = setup();

    expect(controller.addProduct(product.id, 'canonical:line-1', 'item-1')).toBe(true);
    expect(controller.draftLines.value[0]).toMatchObject({ quantity: 1, sourceItemId: 'item-1' });
    await flush();

    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledWith('table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(applied).toEqual([{ result: result(), kind: 'ADD' }]);
    expect(controller.draftLines.value).toEqual([]);

    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/TableOverviewPage.vue'), 'utf8');
    expect(pageSource).not.toContain('orderingWorkspace.value?.');
    expect(pageSource).toContain('orderingController.addProduct(');
    expect(pageSource).toContain("activeMainTab === 'MENU'");
  });

  it('shows three rapid same-product clicks immediately and persists three stable unique intents in order', async () => {
    const requests = [deferred<MerchantOrderMutationResult>(), deferred<MerchantOrderMutationResult>(), deferred<MerchantOrderMutationResult>()];
    requests.forEach((request) => apiMocks.createMerchantTableOrder.mockReturnValueOnce(request.promise));
    const { controller } = setup();

    controller.addProduct(product.id);
    controller.addProduct(product.id);
    controller.addProduct(product.id);
    expect(controller.draftLines.value[0]?.quantity).toBe(3);
    await Promise.resolve();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(1);

    requests[0]!.resolve(result(1));
    await flush();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    requests[1]!.resolve(result(2));
    await flush();
    requests[2]!.resolve(result(3));
    await flush();

    const payloads = apiMocks.createMerchantTableOrder.mock.calls.map((call) => call[1]);
    expect(payloads.map((payload) => payload.items)).toEqual([
      [{ productId: product.id, quantity: 1 }],
      [{ productId: product.id, quantity: 1 }],
      [{ productId: product.id, quantity: 1 }],
    ]);
    expect(new Set(payloads.map((payload) => payload.idempotencyKey)).size).toBe(3);
    expect(controller.draftLines.value).toEqual([]);
  });

  it('keeps different products on independent lanes', async () => {
    const first = deferred<MerchantOrderMutationResult>();
    const second = deferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { controller } = setup();

    controller.addProduct(product.id);
    controller.addProduct(secondProduct.id);
    await Promise.resolve();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    first.resolve(result(1, product));
    second.resolve(result(2, secondProduct));
    await flush();
  });

  it('preserves mixed + + - + click order in the same product lane', async () => {
    const trace: string[] = [];
    apiMocks.createMerchantTableOrder.mockImplementation(async () => {
      trace.push('ADD');
      return result();
    });
    const executeDecrease = vi.fn(async () => {
      trace.push('DECREASE');
      return result();
    });
    const { controller } = setup({ executeDecrease });

    controller.addProduct(product.id);
    controller.addProduct(product.id);
    controller.decreaseProduct(product.id, 'line-1');
    controller.addProduct(product.id);
    await flush();
    await flush();
    expect(trace).toEqual(['ADD', 'ADD', 'DECREASE', 'ADD']);
    expect(executeDecrease).toHaveBeenCalledWith(expect.objectContaining({
      productId: product.id,
      mergeKey: 'line-1',
      requestKey: expect.stringMatching(/^decrease-/),
    }));
  });

  it('rolls back only a definitively failed second add and continues later intents', async () => {
    apiMocks.createMerchantTableOrder
      .mockResolvedValueOnce(result(1))
      .mockRejectedValueOnce(new CashierApiError({ status: 409, code: 'PRODUCT_NOT_AVAILABLE', message: 'off sale' }))
      .mockResolvedValueOnce(result(2));
    const { controller, applied, failures } = setup();
    controller.addProduct(product.id);
    controller.addProduct(product.id);
    controller.addProduct(product.id);
    await flush();
    await flush();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(3);
    expect(applied.filter((entry) => entry.kind === 'ADD')).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(controller.draftLines.value).toEqual([]);
  });

  it('retains an uncertain intent and retries with the exact same idempotency payload', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(result());
    const { controller } = setup();
    controller.addProduct(product.id);
    await flush();
    const firstCall = apiMocks.createMerchantTableOrder.mock.calls[0];
    expect(controller.intents.value[0]?.status).toBe('UNCERTAIN');
    expect(controller.draftLines.value[0]?.quantity).toBe(1);

    controller.retryProduct(product.id);
    await flush();
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]).toEqual(firstCall);
    expect(controller.draftLines.value).toEqual([]);
  });

  it('uses one formal open-only mutation before draining an empty-table add', async () => {
    apiMocks.createMerchantTableOrder.mockResolvedValueOnce({ ...result(), order: null }).mockResolvedValueOnce(result());
    const { controller, applied } = setup({ sessionId: '' });
    controller.addProduct(product.id);
    await flush();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    expect(apiMocks.createMerchantTableOrder.mock.calls[0]?.[1].items).toEqual([]);
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]?.[1].items).toEqual([{ productId: product.id, quantity: 1 }]);
    expect(applied.map((entry) => entry.kind)).toEqual(['OPEN', 'ADD']);
  });

  it('retries an uncertain shared table-open request once and resumes every product lane', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new Error('open response lost'))
      .mockResolvedValueOnce({ ...result(), order: null })
      .mockResolvedValueOnce(result(1, product))
      .mockResolvedValueOnce(result(2, secondProduct));
    const { controller } = setup({ sessionId: '' });
    controller.addProduct(product.id);
    controller.addProduct(secondProduct.id);
    await flush();
    const originalOpenCall = apiMocks.createMerchantTableOrder.mock.calls[0];
    expect(controller.intents.value.every((intent) => intent.status === 'UNCERTAIN')).toBe(true);

    controller.retryProduct(product.id);
    await flush();
    await flush();
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]).toEqual(originalOpenCall);
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(4);
    expect(controller.intents.value).toEqual([]);
  });

  it('releases row busy after a definitive decrease failure', async () => {
    const executeDecrease = vi.fn().mockRejectedValue(new CashierApiError({
      status: 409,
      code: 'ORDER_ITEM_QUANTITY_CHANGED',
      message: 'quantity changed',
    }));
    const { controller, failures } = setup({ executeDecrease });
    controller.decreaseProduct(product.id, 'line-1');
    expect(controller.pendingDecreaseMergeKeys.value.has('line-1')).toBe(true);
    await flush();
    expect(controller.pendingDecreaseMergeKeys.value.has('line-1')).toBe(false);
    expect(failures).toHaveLength(1);
  });

  it('provides synchronous optimistic feedback and row-level decrease busy state', async () => {
    const add = deferred<MerchantOrderMutationResult>();
    const decrease = deferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder.mockReturnValueOnce(add.promise);
    const { controller } = setup({ executeDecrease: vi.fn().mockReturnValue(decrease.promise) });

    const startedAt = performance.now();
    controller.addProduct(product.id);
    expect(performance.now() - startedAt).toBeLessThan(100);
    expect(controller.pendingAddQuantities.value[product.id]).toBe(1);
    add.resolve(result());
    await flush();

    const minusStartedAt = performance.now();
    controller.decreaseProduct(product.id, 'line-1');
    expect(performance.now() - minusStartedAt).toBeLessThan(100);
    expect(controller.pendingDecreaseMergeKeys.value.has('line-1')).toBe(true);
    decrease.resolve(result());
    await flush();
    expect(controller.pendingDecreaseMergeKeys.value.has('line-1')).toBe(false);
    await nextTick();
  });
});
