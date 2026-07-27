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
  status: 'ACCEPTED',
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

function session(pendingOrderCount = 0): TableSessionDetail {
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
      createdByStaffId: order.createdByStaffId,
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

  it('renders one merged dine-in item stream without order tabs or cards', () => {
    const wrapper = mountDetail();
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');
    expect(wrapper.get('.table-item-summary-row__source').text()).toBe('顾客');
    expect(wrapper.find('[data-testid="table-detail-tabs"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="table-order-details"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dinein-accept"]').exists()).toBe(false);
  });

  it('counts total dish quantity and keeps every source row adjustable while the session is open', async () => {
    const base = session();
    const customerOrder = {
      ...base.orders[0]!,
      items: [{ ...base.orders[0]!.items[0]!, quantity: 3, subtotalVnd: '180000' }],
    };
    const staffOrder = {
      ...customerOrder,
      id: 'order-staff',
      orderNo: 'O-1002',
      status: 'ACCEPTED' as const,
      createdByStaffId: 'staff-1',
      items: [{ ...base.orders[0]!.items[0]!, id: 'item-staff', quantity: 2, subtotalVnd: '120000' }],
    };
    const lastOrder = {
      ...base.orders[0]!,
      id: 'order-last',
      orderNo: 'O-1003',
      status: 'ACCEPTED' as const,
      items: [{ ...base.orders[0]!.items[0]!, id: 'item-last', quantity: 2, subtotalVnd: '120000' }],
    };
    const wrapper = mountDetail({
      session: { ...base, orderCount: 3, itemCount: 7, orders: [customerOrder, staffOrder, lastOrder] },
    });
    expect(wrapper.get('.table-detail-header__meta').text()).toContain('7 个菜');
    const rows = wrapper.findAll('.table-item-summary-row');
    expect(rows).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="decrease-order-item"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="decrease-order-item"]').every((button) => button.attributes('disabled') === undefined)).toBe(true);
    expect(rows[2]!.text()).toContain('× 2');
    await rows[2]!.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('returnItem')?.[0]?.[0]).toMatchObject({ id: 'item-last' });
    await wrapper.setProps({ session: { ...base, orderCount: 2, itemCount: 5, orders: [customerOrder, staffOrder] } });
    expect(wrapper.get('.table-detail-header__meta').text()).toContain('5 个菜');
    expect(wrapper.findAll('.table-item-summary-row')).toHaveLength(2);
  });

  it('keeps the adjustment column but disables completed rows with a status reason', () => {
    const base = session();
    const wrapper = mountDetail({ session: { ...base, orders: [{ ...base.orders[0]!, status: 'COMPLETED' as const }] } });
    const button = wrapper.get('[data-testid="decrease-order-item"]');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toContain('订单状态');
  });

  it('keeps only the payable total in the compact settlement row', () => {
    const wrapper = mountDetail({
      session: { ...session(0), originalAmountVnd: '513000', roundingApplied: true, roundingAmountVnd: '3000', payableAmountVnd: '510000' },
      roundingApplied: true,
      roundingAmount: '3000',
      payableAmount: '510000',
    });
    expect(wrapper.find('[data-testid="table-settlement-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="table-rounding-rule"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="dinein-rounding"]').text()).toBe('取消');
    expect(wrapper.get('.table-bill-total-row').text()).toContain('510,000');
    expect(wrapper.get('.table-bill-total-row').text()).toContain('加菜');
    expect(wrapper.get('.dinein-summary-row').classes()).toContain('dinein-summary-row');
    expect(wrapper.get('[data-testid="table-order-items"]').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-action-dock"] .dinein-action-button').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-rounding"]').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-checkout"]').classes()).toContain('dinein-action-button');
  });

  it.each(['14000000', '99999999'])('keeps long total %s complete and on one line', (amount) => {
    const wrapper = mountDetail({
      session: { ...session(0), totalAmountVnd: amount, payableAmountVnd: amount },
      payableAmount: amount,
    });
    const total = wrapper.get('.table-bill-total-row strong');
    expect(total.text()).toContain(Number(amount).toLocaleString('en-US'));
    expect(total.attributes('title')).toContain(Number(amount).toLocaleString('en-US'));
    expect(wrapper.get('.table-item-summary-row').find('[data-testid="decrease-order-item"]').exists()).toBe(true);
  });

  it('keeps source, item, quantity, amount and remove action on one row', async () => {
    const wrapper = mountDetail();
    expect(wrapper.get('.table-detail-header').text()).not.toContain('人数数据未提供');
    const row = wrapper.get('.table-item-summary-row');
    expect(row.text()).toContain('牛肉粉');
    expect(row.text()).toContain('120,000');
    expect(row.find('[data-testid="decrease-order-item"]').exists()).toBe(true);
    await row.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('returnItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });

  it('keeps print, rounding and checkout in the bottom action dock', async () => {
    const wrapper = mountDetail({
      actionsDisabled: true,
      checkoutDisabled: true,
    });
    expect(wrapper.get('[data-testid="print-primary"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-rounding"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeDefined();

    await wrapper.setProps({
      actionsDisabled: false,
      checkoutDisabled: false,
    });
    expect(wrapper.get('[data-testid="dinein-rounding"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('接单');
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

  it('labels staff additions as 加菜 and keeps the remove action after amount', async () => {
    const accepted = { ...order, status: 'ACCEPTED' as const, createdByStaffId: 'staff-1' };
    const wrapper = mountDetail({ session: {
      ...session(0),
      orders: [{ ...session(0).orders[0]!, status: 'ACCEPTED' as const, createdByStaffId: accepted.createdByStaffId }],
    } });
    expect(wrapper.get('.table-item-summary-row__source').text()).toContain('加菜');
    expect(wrapper.find('[data-testid="decrease-order-item"]').exists()).toBe(true);
    await wrapper.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('returnItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });
});
