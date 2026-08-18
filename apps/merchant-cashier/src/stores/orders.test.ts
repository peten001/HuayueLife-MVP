import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantOrder } from '@/types';

const apiMocks = vi.hoisted(() => ({
  getMerchantOrder: vi.fn(),
  listMerchantOrders: vi.fn(),
  listMerchantSettlements: vi.fn(),
  getMerchantSettlement: vi.fn(),
  runMerchantOrderAction: vi.fn(),
  setMerchantOrderSettlementAdjustment: vi.fn(),
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
    apiMocks.listMerchantSettlements.mockReset();
    apiMocks.getMerchantSettlement.mockReset();
    apiMocks.runMerchantOrderAction.mockReset();
    apiMocks.setMerchantOrderSettlementAdjustment.mockReset();
  });

  it('stores grouped settlement history with the server total', async () => {
    const page = {
      items: [
        {
          settlementId: 'session:415',
          kind: 'TABLE_SESSION',
          orderType: 'DINE_IN',
          status: 'COMPLETED',
          businessDate: '2026-08-17',
          settledAt: '2026-08-17T10:42:15.000Z',
          tableSessionId: '415',
          tableId: '9',
          tableName: 'Bàn 9',
          orderIds: ['628', '632', '633'],
          orderNos: ['HY-TEST-628', 'HY-TEST-632', 'HY-TEST-633'],
          orderCount: 3,
          itemQuantity: 4,
          items: [],
          originalAmountVnd: '309000',
          discountAmountVnd: '0',
          roundingAmountVnd: '9000',
          finalReceivableVnd: '300000',
          paymentMethod: 'CASH',
          sourceOrders: [],
          invariantViolations: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      hasMore: false,
    };
    apiMocks.listMerchantSettlements.mockResolvedValueOnce(page);
    const store = useOrdersStore();

    const result = await store.fetchSettlements({ date: '2026-08-17' });

    expect(result).toHaveLength(1);
    expect(store.historySettlements[0]?.orderCount).toBe(3);
    expect(store.historySettlements[0]?.finalReceivableVnd).toBe('300000');
    expect(store.settlementTotal).toBe(1);
  });

  it('loads a settlement detail and selects it for the history panel', async () => {
    const detail = {
      settlementId: 'session:417',
      kind: 'TABLE_SESSION',
      orderType: 'DINE_IN',
      status: 'COMPLETED',
      businessDate: '2026-08-17',
      settledAt: '2026-08-17T13:41:04.000Z',
      tableSessionId: '417',
      tableId: '02',
      tableName: '02',
      orderIds: ['630', '631', '646', '648', '652'],
      orderNos: ['A', 'B', 'C', 'D', 'E'],
      orderCount: 5,
      itemQuantity: 12,
      items: [],
      originalAmountVnd: '1458000',
      discountAmountVnd: '0',
      roundingAmountVnd: '8000',
      finalReceivableVnd: '1450000',
      paymentMethod: 'CASH',
      sourceOrders: [
        {
          id: '630',
          orderNo: 'A',
          status: 'COMPLETED',
          createdAt: '2026-08-17T10:19:21.000Z',
          completedAt: '2026-08-17T13:41:04.000Z',
          cancelledAt: null,
          totalAmountVnd: '598000',
          paymentMethod: 'CASH',
        },
      ],
      invariantViolations: [],
    };
    apiMocks.getMerchantSettlement.mockResolvedValueOnce(detail);
    const store = useOrdersStore();

    const loaded = await store.selectSettlement('session:417');

    expect(loaded?.roundingAmountVnd).toBe('8000');
    expect(store.selectedSettlement?.finalReceivableVnd).toBe('1450000');
  });

  it('clears settlement history and detail when the store is cleared', async () => {
    apiMocks.listMerchantSettlements.mockResolvedValueOnce({
      items: [], total: 0, page: 1, pageSize: 50, hasMore: false,
    });
    const store = useOrdersStore();
    await store.fetchSettlements({});
    store.clear();
    expect(store.historySettlements).toEqual([]);
    expect(store.selectedSettlement).toBeNull();
    expect(store.settlementTotal).toBe(0);
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

  it('uses the Backend adjustment response as the selected and cached authority', async () => {
    const pickup = { ...pendingOrder, orderType: 'PICKUP' as const, status: 'ACCEPTED' as const };
    const authoritative = {
      ...pickup,
      discountPayableRateBps: 9000,
      discountAmountVnd: '5000',
      roundingApplied: true,
      roundingAmountVnd: '5000',
      payableAmountVnd: '40000',
    };
    apiMocks.listMerchantOrders.mockResolvedValueOnce([pickup]);
    apiMocks.getMerchantOrder.mockResolvedValueOnce(pickup);
    apiMocks.setMerchantOrderSettlementAdjustment.mockResolvedValueOnce(authoritative);
    const store = useOrdersStore();
    await store.fetchPending();
    await store.selectOrder(pickup.id);

    await store.setSettlementAdjustment(pickup.id, {
      discountPayableRateBps: 9000,
      roundingEnabled: true,
    });

    expect(apiMocks.setMerchantOrderSettlementAdjustment).toHaveBeenCalledWith(pickup.id, {
      discountPayableRateBps: 9000,
      roundingEnabled: true,
    });
    expect(store.selectedOrder).toMatchObject({
      discountAmountVnd: '5000',
      roundingAmountVnd: '5000',
      payableAmountVnd: '40000',
    });
    expect(store.activeOrders[0]).toMatchObject({ payableAmountVnd: '40000' });
  });

  it('uses the Backend clear-adjustment response instead of calculating the restored amount locally', async () => {
    const pickup = {
      ...pendingOrder,
      orderType: 'PICKUP' as const,
      status: 'ACCEPTED' as const,
      discountPayableRateBps: 8500,
      discountAmountVnd: '7500',
      roundingApplied: true,
      roundingAmountVnd: '2500',
      payableAmountVnd: '40000',
    };
    const authoritative = {
      ...pickup,
      discountPayableRateBps: null,
      discountAmountVnd: '0',
      roundingApplied: false,
      roundingAmountVnd: '0',
      payableAmountVnd: '50000',
    };
    apiMocks.listMerchantOrders.mockResolvedValueOnce([pickup]);
    apiMocks.getMerchantOrder.mockResolvedValueOnce(pickup);
    apiMocks.setMerchantOrderSettlementAdjustment.mockResolvedValueOnce(authoritative);
    const store = useOrdersStore();
    await store.fetchPending();
    await store.selectOrder(pickup.id);

    await store.setSettlementAdjustment(pickup.id, {
      discountPayableRateBps: null,
      roundingEnabled: false,
    });

    expect(apiMocks.setMerchantOrderSettlementAdjustment).toHaveBeenCalledWith(pickup.id, {
      discountPayableRateBps: null,
      roundingEnabled: false,
    });
    expect(store.selectedOrder).toMatchObject({
      discountPayableRateBps: null,
      discountAmountVnd: '0',
      roundingApplied: false,
      roundingAmountVnd: '0',
      payableAmountVnd: '50000',
    });
    expect(store.activeOrders[0]).toMatchObject({ payableAmountVnd: '50000' });
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
