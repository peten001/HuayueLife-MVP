import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantOrder } from '@/types';

const apiMocks = vi.hoisted(() => ({
  getMerchantOrder: vi.fn(),
  listMerchantOrders: vi.fn(),
  runMerchantOrderAction: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import { useOrdersStore } from './orders';

const pendingOrder: MerchantOrder = {
  id: 'order-1',
  orderNo: 'TEST-1001',
  merchantId: 'merchant-1',
  orderType: 'DINE_IN',
  status: 'PENDING_ACCEPTANCE',
  itemAmountVnd: '50000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '50000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  items: [],
};

describe('cashier order store request isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getMerchantOrder.mockReset();
    apiMocks.listMerchantOrders.mockReset();
    apiMocks.runMerchantOrderAction.mockReset();
  });

  it('does not restore previous-merchant orders after the store is cleared', async () => {
    const deferred = createDeferred<MerchantOrder[]>();
    apiMocks.listMerchantOrders.mockReturnValueOnce(deferred.promise);
    const store = useOrdersStore();

    const request = store.fetchPending();
    store.clear();
    deferred.resolve([pendingOrder]);
    await request;

    expect(store.pendingOrders).toEqual([]);
    expect(store.selectedOrder).toBeNull();
  });

  it('does not let an older detail response overwrite a successful order action', async () => {
    apiMocks.listMerchantOrders.mockResolvedValueOnce([pendingOrder]);
    const store = useOrdersStore();
    await store.fetchPending();

    const staleDetail = createDeferred<MerchantOrder>();
    apiMocks.getMerchantOrder.mockReturnValueOnce(staleDetail.promise);
    const detailRequest = store.selectOrder(pendingOrder.id);
    const acceptedOrder = { ...pendingOrder, status: 'ACCEPTED' as const };
    apiMocks.runMerchantOrderAction.mockResolvedValueOnce(acceptedOrder);

    await store.runAction(pendingOrder.id, 'accept');
    staleDetail.resolve(pendingOrder);
    await detailRequest;

    expect(store.selectedOrder?.status).toBe('ACCEPTED');
    expect(store.activeOrders.map((order) => order.id)).toEqual([pendingOrder.id]);
  });

  it('applies an item-adjustment snapshot to the selected order and live list', async () => {
    apiMocks.listMerchantOrders.mockResolvedValueOnce([pendingOrder]);
    apiMocks.getMerchantOrder.mockResolvedValueOnce(pendingOrder);
    const store = useOrdersStore();
    await store.fetchPending();
    await store.selectOrder(pendingOrder.id);

    const adjusted = { ...pendingOrder, totalAmountVnd: '25000', itemAmountVnd: '25000' };
    store.applyOrderSnapshot(adjusted);

    expect(store.selectedOrder?.totalAmountVnd).toBe('25000');
    expect(store.pendingOrders[0]?.totalAmountVnd).toBe('25000');
  });

  it('does not let an older polling response overwrite an item-adjustment snapshot', async () => {
    apiMocks.listMerchantOrders.mockResolvedValueOnce([pendingOrder]);
    const store = useOrdersStore();
    await store.fetchPending();

    const stalePolling = createDeferred<MerchantOrder[]>();
    apiMocks.listMerchantOrders.mockReturnValueOnce(stalePolling.promise);
    const staleRequest = store.fetchPending();

    const adjusted = { ...pendingOrder, totalAmountVnd: '25000', itemAmountVnd: '25000' };
    store.applyOrderSnapshot(adjusted, true);
    stalePolling.resolve([pendingOrder]);
    await staleRequest;

    expect(store.selectedOrder?.totalAmountVnd).toBe('25000');
    expect(store.pendingOrders[0]?.totalAmountVnd).toBe('25000');
    expect(store.detailLoading).toBe(false);
  });

  it('force live refresh bypasses in-flight polling and only applies the newest revision', async () => {
    const stalePolling = createDeferred<MerchantOrder[]>();
    const forcedPolling = createDeferred<MerchantOrder[]>();
    let pendingCall = 0;
    apiMocks.listMerchantOrders.mockImplementation((filters: { status?: string }) => {
      if (filters.status !== 'PENDING_ACCEPTANCE') return Promise.resolve([]);
      pendingCall += 1;
      return pendingCall === 1 ? stalePolling.promise : forcedPolling.promise;
    });
    const store = useOrdersStore();

    const staleRequest = store.refreshLiveOrders();
    const forcedRequest = store.refreshLiveOrders({ force: true });
    const refreshed = { ...pendingOrder, totalAmountVnd: '75000', itemAmountVnd: '75000' };
    forcedPolling.resolve([refreshed]);
    await forcedRequest;
    stalePolling.resolve([pendingOrder]);
    await staleRequest;

    expect(pendingCall).toBe(2);
    expect(store.pendingOrders[0]?.totalAmountVnd).toBe('75000');
    expect(store.pendingLoading).toBe(false);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
