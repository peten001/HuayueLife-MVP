import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import type { MerchantOrder, TableCardView, TableSessionDetail } from '@/types';
import TableBillDetail from './TableBillDetail.vue';

const table: TableCardView = {
  id: 'table-1',
  merchantId: 'merchant-1',
  tableNo: 'A01',
  qrToken: 'not-a-real-token',
  qrVersion: 1,
  status: 'ACTIVE',
  operationalStatus: 'IN_USE',
  canCloseSession: false,
  currentSession: null,
};

const order: MerchantOrder = {
  id: 'order-1',
  orderNo: 'O-1001',
  merchantId: 'merchant-1',
  orderType: 'DINE_IN',
  status: 'PENDING_ACCEPTANCE',
  tableId: 'table-1',
  tableSessionId: 'session-1',
  tableNoSnapshot: 'A01',
  itemAmountVnd: '120000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '120000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-24T01:00:00.000Z',
  updatedAt: '2026-07-24T01:00:00.000Z',
  customerRemark: '少辣',
  items: [{
    id: 'item-1',
    productNameZhSnapshot: '牛肉粉',
    productNameViSnapshot: 'Phở bò',
    productNameEnSnapshot: 'Beef pho',
    unitPriceVnd: '60000',
    quantity: 2,
    subtotalVnd: '120000',
  }],
};

function session(pendingOrderCount = 1): TableSessionDetail {
  return {
    id: 'session-1',
    sessionNo: 'TS-1',
    merchantId: 'merchant-1',
    tableId: 'table-1',
    tableNo: 'A01',
    status: 'OPEN',
    openedAt: '2026-07-24T00:00:00.000Z',
    orderCount: 1,
    itemCount: 2,
    totalAmountVnd: '120000',
    pendingOrderCount,
    unfinishedOrderCount: 1,
    orders: [{
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      createdAt: order.createdAt,
      itemAmountVnd: order.itemAmountVnd,
      deliveryFeeVnd: order.deliveryFeeVnd,
      totalAmountVnd: order.totalAmountVnd,
      items: order.items.map((item) => ({
        id: item.id,
        productNameZhSnapshot: item.productNameZhSnapshot,
        quantity: item.quantity,
        unitPriceVnd: item.unitPriceVnd || '0',
        subtotalVnd: item.subtotalVnd,
      })),
    }],
  };
}

function mountDetail(extraProps: Record<string, unknown> = {}) {
  return mount(TableBillDetail, {
    props: { table, session: session(), ...extraProps },
    global: {
      plugins: [createPinia()],
      stubs: {
        PrintJobActions: {
          props: ['disabled'],
          template: '<button data-testid="print-primary" :disabled="disabled">Print</button>',
        },
      },
    },
  });
}

describe('TableBillDetail V2 table workspace', () => {
  afterEach(() => setLocale('zh'));

  it('keeps summary and order detail inside one right-hand workspace', async () => {
    const wrapper = mountDetail();
    expect(wrapper.get('[data-testid="table-summary-tab"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');

    await wrapper.get('[data-testid="table-orders-tab"]').trigger('click');
    expect(wrapper.get('[data-testid="table-order-details"]').text()).toContain('O-1001');
    expect(wrapper.find('[data-testid="table-selected-order"]').exists()).toBe(false);
    await wrapper.get('.bill-order-row').trigger('click');
    expect(wrapper.emitted('openOrder')?.[0]?.[0]).toMatchObject({ id: 'order-1' });
  });

  it('shows the persisted original, rounding and received table amounts', () => {
    const wrapper = mountDetail({
      session: { ...session(0), originalAmountVnd: '513000', roundingApplied: true, roundingAmountVnd: '3000', payableAmountVnd: '510000' },
      roundingApplied: true,
      roundingAmount: '3000',
      payableAmount: '510000',
    });
    const settlement = wrapper.get('[data-testid="table-settlement-summary"]');
    expect(settlement.text()).toContain('513,000');
    expect(settlement.text()).toContain('3,000');
    expect(settlement.text()).toContain('510,000');
    expect(wrapper.get('[data-testid="table-rounding-rule"]').text()).toContain('10,000');
    expect(wrapper.get('.table-bill-total-row').text()).toContain('510,000');
  });

  it('shows the selected order items, unit price and pending decrease in the same panel', async () => {
    const wrapper = mountDetail({ order });
    expect(wrapper.get('.table-detail-header').text()).not.toContain('人数数据未提供');
    const selected = wrapper.get('[data-testid="table-selected-order"]');
    expect(selected.text()).toContain('牛肉粉');
    expect(selected.text()).toContain('顾客扫码订单');
    expect(selected.text()).toContain('60,000');
    expect(selected.text()).toContain('120,000');
    await selected.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });

  it('keeps print independent and gates checkout only through the pending-order prop', async () => {
    const wrapper = mountDetail({
      actionsDisabled: true,
      acceptDisabled: false,
      checkoutDisabled: true,
    });
    expect(wrapper.get('[data-testid="print-primary"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-accept"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeDefined();

    await wrapper.setProps({
      session: session(0),
      actionsDisabled: false,
      acceptDisabled: true,
      checkoutDisabled: false,
    });
    expect(wrapper.get('[data-testid="dinein-accept"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('制作完成');
    expect(wrapper.text()).not.toContain('完成桌账');
  });

  it('preserves empty-table opening without showing dine-in chat', async () => {
    const empty = { ...table, operationalStatus: 'AVAILABLE' as const };
    const wrapper = mountDetail({ table: empty, session: null });
    const open = wrapper.get('[data-testid="table-order-items"]');
    expect(open.text()).toContain('开台点菜');
    expect(wrapper.find('.order-chat-workspace').exists()).toBe(false);
    await open.trigger('click');
    expect(wrapper.emitted('orderItems')).toEqual([[]]);
  });

  it('shows return rather than decrease after acceptance', async () => {
    const accepted = { ...order, status: 'ACCEPTED' as const, createdByStaffId: 'staff-1' };
    const wrapper = mountDetail({ order: accepted, session: {
      ...session(0),
      orders: [{ ...session(0).orders[0]!, status: 'ACCEPTED' as const }],
    } });
    expect(wrapper.get('[data-testid="table-selected-order"]').text()).toContain('收银员人工点菜');
    expect(wrapper.find('[data-testid="decrease-order-item"]').exists()).toBe(false);
    await wrapper.get('[data-testid="return-order-item"]').trigger('click');
    expect(wrapper.emitted('returnItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });
});
