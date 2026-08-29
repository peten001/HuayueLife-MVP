import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantSettlement } from '@/types';
import { useOrdersStore } from '@/stores';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import OrderHistoryPage from './OrderHistoryPage.vue';

const mocks = vi.hoisted(() => ({
  route: { params: { orderId: 'settlement-1' } },
  push: vi.fn(),
  getBusinessDaySummary: vi.fn(),
  printBusinessDaySummary: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api');
  return {
    ...actual,
    getBusinessDaySummary: mocks.getBusinessDaySummary,
    printBusinessDaySummary: mocks.printBusinessDaySummary,
  };
});

describe('OrderHistoryPage settlement printing', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    mocks.getBusinessDaySummary.mockRejectedValue(new Error('summary not needed'));
  });

  it.each([
    {
      name: 'multi-order table settlement',
      settlement: settlementFixture({
        kind: 'TABLE_SESSION',
        orderType: 'DINE_IN',
        tableSessionId: 'session-417',
        orderIds: ['order-651', 'order-652'],
      }),
      expected: { tableSessionId: 'session-417', orderId: undefined },
    },
    {
      name: 'single-order table settlement',
      settlement: settlementFixture({
        kind: 'TABLE_SESSION',
        orderType: 'DINE_IN',
        tableSessionId: 'session-418',
        orderIds: ['order-653'],
      }),
      expected: { tableSessionId: 'session-418', orderId: undefined },
    },
    {
      name: 'pickup settlement without a table session',
      settlement: settlementFixture({
        kind: 'ORDER',
        orderType: 'PICKUP',
        tableSessionId: null,
        orderIds: ['order-654'],
      }),
      expected: { tableSessionId: undefined, orderId: 'order-654' },
    },
  ])('renders exactly one existing print action for $name', async ({ settlement, expected }) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const orders = useOrdersStore();
    orders.$patch({
      selectedSettlement: settlement,
      historySettlements: [settlement],
    });
    vi.spyOn(orders, 'selectSettlement').mockResolvedValue(settlement);
    vi.spyOn(orders, 'fetchSettlements').mockResolvedValue([settlement]);

    const wrapper = shallowMount(OrderHistoryPage, {
      global: { plugins: [pinia] },
    });
    await flushPromises();

    const actions = wrapper.findAllComponents(PrintJobActions);
    expect(actions).toHaveLength(1);
    expect(wrapper.get('[data-testid="settlement-financials"]')
      .findComponent(PrintJobActions).exists()).toBe(true);
    expect(actions[0].props('tableSessionId')).toBe(expected.tableSessionId);
    expect(actions[0].props('orderId')).toBe(expected.orderId);
    expect(actions[0].props('compactMode')).toBe('inline');
    wrapper.unmount();
  });
});

function settlementFixture(
  overrides: Pick<MerchantSettlement, 'kind' | 'orderType' | 'tableSessionId' | 'orderIds'>,
): MerchantSettlement {
  return {
    settlementId: 'settlement-1',
    kind: overrides.kind,
    orderType: overrides.orderType,
    status: 'COMPLETED',
    businessDate: '2026-08-29',
    settledAt: '2026-08-29T02:00:00.000Z',
    tableSessionId: overrides.tableSessionId,
    tableId: overrides.tableSessionId ? 'table-11' : null,
    tableName: overrides.tableSessionId ? 'A01' : null,
    orderIds: overrides.orderIds,
    orderNos: overrides.orderIds.map((id) => `NO-${id}`),
    orderCount: overrides.orderIds.length,
    itemQuantity: 1,
    items: [{
      id: 'item-1',
      productId: 'product-1',
      productNameZh: '牛肉粉',
      productNameVi: 'Phở bò',
      productNameEn: null,
      imageUrl: null,
      unitPriceVnd: '100000',
      quantity: 1,
      subtotalVnd: '100000',
      remark: null,
    }],
    originalAmountVnd: '100000',
    discountAmountVnd: '0',
    roundingAmountVnd: '0',
    finalReceivableVnd: '100000',
    paymentMethod: 'CASH',
    sourceOrders: overrides.orderIds.map((id) => ({
      id,
      orderNo: `NO-${id}`,
      status: 'COMPLETED',
      createdAt: '2026-08-29T01:00:00.000Z',
      completedAt: '2026-08-29T02:00:00.000Z',
      cancelledAt: null,
      totalAmountVnd: '100000',
      paymentMethod: 'CASH',
    })),
    invariantViolations: [],
  };
}
