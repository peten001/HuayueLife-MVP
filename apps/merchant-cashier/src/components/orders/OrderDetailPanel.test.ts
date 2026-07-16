import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import type { CashierOrderView } from '@/components/common/view-models';
import OrderDetailPanel from './OrderDetailPanel.vue';

const order: CashierOrderView = {
  id: 'order-1',
  orderNo: 'O-1001',
  tableNoSnapshot: 'A05',
  orderType: 'DINE_IN',
  status: 'PENDING_ACCEPTANCE',
  itemAmountVnd: '120000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '120000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-16T08:00:00.000Z',
  items: [
    {
      id: 'item-1',
      productNameZhSnapshot: '牛肉粉',
      productNameViSnapshot: 'Phở bò',
      productNameEnSnapshot: 'Beef pho',
      quantity: 2,
      subtotalVnd: '120000',
      remark: '少辣',
    },
  ],
};

describe('OrderDetailPanel final action layout', () => {
  it('keeps items in the scroll region and removes the standalone print card', () => {
    const wrapper = mount(OrderDetailPanel, {
      props: { order },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.get('[data-testid="order-item-scroll"]').text()).toContain('牛肉粉');
    expect(wrapper.find('.print-job-actions').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="print-primary"]')).toHaveLength(1);
  });

  it('orders new-order actions as reject, print, accept in one fixed row', () => {
    const wrapper = mount(OrderDetailPanel, {
      props: { order },
      global: { plugins: [createPinia()] },
    });
    const actionRow = wrapper.get('[data-testid="order-detail-actions"]');

    expect(actionRow.classes()).toContain('order-action-bar--paired');
    expect(actionRow.get('[data-order-action="reject"]').text()).toContain('拒单');
    expect(actionRow.get('[data-testid="print-primary"]').text()).toContain('打印');
    expect(actionRow.get('[data-order-action="accept"]').text()).toContain('接单');
    expect(actionRow.findAll('button')).toHaveLength(3);
  });

  it('preserves the existing reject and accept events', async () => {
    const wrapper = mount(OrderDetailPanel, {
      props: { order },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get('[data-order-action="reject"]').trigger('click');
    await wrapper.get('[data-order-action="accept"]').trigger('click');
    expect(wrapper.emitted('action')).toEqual([['reject'], ['accept']]);
  });
});
