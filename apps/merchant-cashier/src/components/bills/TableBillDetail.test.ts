import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import type { TableCardView, TableSessionDetail } from '@/types';
import { setLocale } from '@/i18n';
import TableBillDetail from './TableBillDetail.vue';

function session(unfinishedOrderCount = 0): TableSessionDetail {
  return {
    id: 'session-1',
    sessionNo: 'TS-1',
    merchantId: 'merchant-1',
    tableId: 'table-1',
    tableNo: 'A05',
    status: 'OPEN',
    openedAt: '2026-07-16T07:00:00.000Z',
    orderCount: 2,
    itemCount: 4,
    totalAmountVnd: '180000',
    pendingOrderCount: unfinishedOrderCount,
    unfinishedOrderCount,
    orders: [
      {
        id: 'order-1',
        orderNo: 'O-1001',
        status: unfinishedOrderCount ? 'PREPARING' : 'COMPLETED',
        createdAt: '2026-07-16T07:10:00.000Z',
        itemAmountVnd: '120000',
        deliveryFeeVnd: '0',
        totalAmountVnd: '120000',
        items: [
          { id: 'i-1', productNameZhSnapshot: '牛肉粉', quantity: 1, unitPriceVnd: '60000', subtotalVnd: '60000' },
          { id: 'i-2', productNameZhSnapshot: '牛肉粉', quantity: 1, unitPriceVnd: '60000', subtotalVnd: '60000' },
        ],
      },
      {
        id: 'order-2',
        orderNo: 'O-1002',
        status: 'COMPLETED',
        createdAt: '2026-07-16T07:20:00.000Z',
        itemAmountVnd: '60000',
        deliveryFeeVnd: '0',
        totalAmountVnd: '60000',
        items: [
          { id: 'i-3', productNameZhSnapshot: '柠檬茶', quantity: 2, unitPriceVnd: '30000', subtotalVnd: '60000' },
        ],
      },
    ],
  };
}

function emptyTable(): TableCardView {
  return {
    id: 'table-2',
    merchantId: 'merchant-1',
    tableNo: 'B05',
    qrToken: 'table-2-qr',
    qrVersion: 1,
    status: 'ACTIVE',
    currentSession: null,
    operationalStatus: 'AVAILABLE',
    canCloseSession: false,
  };
}

function mountDetail(detail: TableSessionDetail | null = session(), table?: TableCardView) {
  return mount(TableBillDetail, {
    props: { session: detail, table },
    global: { plugins: [createPinia()] },
  });
}

describe('TableBillDetail final panel', () => {
  afterEach(() => setLocale('zh'));

  it('defaults to aggregated items and switches to existing order details', async () => {
    const wrapper = mountDetail();

    expect(wrapper.get('[data-testid="table-summary-tab"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('× 2');
    expect(wrapper.find('[data-testid="table-order-details"]').exists()).toBe(false);

    await wrapper.get('[data-testid="table-orders-tab"]').trigger('click');
    expect(wrapper.get('[data-testid="table-orders-tab"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[data-testid="table-order-details"]').text()).toContain('O-1001');
    expect(wrapper.get('[data-testid="table-order-details"]').text()).toContain('O-1002');
  });

  it('uses one in-panel order/print/complete row without a standalone print card', () => {
    const wrapper = mountDetail();
    const actions = wrapper.get('[data-testid="table-detail-actions"]');

    expect(wrapper.find('.print-job-actions').exists()).toBe(false);
    expect(actions.findAll('button')).toHaveLength(3);
    expect(actions.get('[data-testid="table-order-items"]').text()).toContain('点菜');
    expect(actions.get('[data-testid="print-primary"]').text()).toContain('打印桌账');
    expect(actions.get('.table-close-action').text()).toContain('完成桌账');
  });

  it('shows ordering only for an open TableSession and emits the existing table context', async () => {
    const wrapper = mountDetail();

    await wrapper.get('[data-testid="table-order-items"]').trigger('click');
    expect(wrapper.emitted('orderItems')).toEqual([[]]);

    await wrapper.setProps({ session: { ...session(), status: 'CLOSED' } });
    expect(wrapper.find('[data-testid="table-order-items"]').exists()).toBe(false);
  });

  it('shows open-table action for an empty table and emits order context', async () => {
    const wrapper = mountDetail(null, emptyTable());

    const openAction = wrapper.get('[data-testid="table-order-items"]');
    expect(openAction.text()).toContain('开台点菜');
    await openAction.trigger('click');
    expect(wrapper.emitted('orderItems')).toEqual([[]]);

    await wrapper.setProps({ table: { ...emptyTable(), status: 'DISABLED' } });
    expect(wrapper.find('[data-testid="table-order-items"]').exists()).toBe(false);
  });

  it.each([
    ['zh', '开台点菜'],
    ['vi', 'Mở bàn và gọi món'],
    ['en', 'Open Table & Order'],
  ])('renders empty-table open action label in %s locale', (locale, label) => {
    setLocale(locale as 'zh' | 'vi' | 'en');
    const wrapper = mountDetail(null, emptyTable());
    expect(wrapper.get('[data-testid="table-order-items"]').text()).toContain(label);
  });

  it('keeps the unfinished-order close gate and compact warning', async () => {
    const wrapper = mountDetail(session(2));
    const closeButton = wrapper.get<HTMLButtonElement>('.table-close-action');

    expect(wrapper.get('.detail-notice').text()).toBe('仍有 2 笔订单未完成，暂不能关闭桌台。');
    expect(closeButton.attributes('disabled')).toBeDefined();
    await closeButton.trigger('click');
    expect(wrapper.emitted('closeSession')).toBeUndefined();
  });

  it('preserves the existing close event and order-detail selection event', async () => {
    const wrapper = mountDetail();

    await wrapper.get('.table-close-action').trigger('click');
    expect(wrapper.emitted('closeSession')).toEqual([[]]);

    await wrapper.get('[data-testid="table-orders-tab"]').trigger('click');
    await wrapper.get('.bill-order-row').trigger('click');
    expect(wrapper.emitted('openOrder')?.[0]?.[0]).toMatchObject({ id: 'order-1' });
  });
});
