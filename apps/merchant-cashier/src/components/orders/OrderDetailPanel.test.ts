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

const tableOrder: CashierOrderView = {
  ...order,
  tableSessionId: 'session-1',
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

  it('shows decrease without a plus button only for a pending table order', async () => {
    const wrapper = mount(OrderDetailPanel, {
      props: { order: tableOrder },
      global: { plugins: [createPinia()] },
    });

    const decrease = wrapper.get('[data-testid="decrease-order-item"]');
    expect(decrease.text()).toContain('减菜');
    expect(wrapper.find('[data-testid="return-order-item"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="增加数量"]').exists()).toBe(false);
    await decrease.trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-1', quantity: 2 });
  });

  it.each(['ACCEPTED', 'PREPARING', 'READY'] as const)(
    'shows return for a %s table order',
    async (status) => {
      const wrapper = mount(OrderDetailPanel, {
        props: { order: { ...tableOrder, status } },
        global: { plugins: [createPinia()] },
      });

      await wrapper.get('[data-testid="return-order-item"]').trigger('click');
      expect(wrapper.find('[data-testid="decrease-order-item"]').exists()).toBe(false);
      expect(wrapper.emitted('returnItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
    },
  );

  it.each(['COMPLETED', 'CANCELLED', 'DELIVERING'] as const)(
    'does not expose item adjustment for %s',
    (status) => {
      const wrapper = mount(OrderDetailPanel, {
        props: { order: { ...tableOrder, status } },
        global: { plugins: [createPinia()] },
      });

      expect(wrapper.find('[data-testid="decrease-order-item"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="return-order-item"]').exists()).toBe(false);
    },
  );

  it('disables every item-adjustment control while a mutation is in flight', () => {
    const twoItemOrder = {
      ...tableOrder,
      items: [
        ...tableOrder.items!,
        { ...tableOrder.items![0]!, id: 'item-2', productNameZhSnapshot: '柠檬茶' },
      ],
    };
    const wrapper = mount(OrderDetailPanel, {
      props: { order: twoItemOrder, adjustmentLoadingId: 'item-1' },
      global: { plugins: [createPinia()] },
    });

    for (const button of wrapper.findAll('[data-testid="decrease-order-item"]')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });

  it('allows only the same-key decrease retry after an uncertain outcome', () => {
    const twoItemOrder = {
      ...tableOrder,
      items: [
        ...tableOrder.items!,
        { ...tableOrder.items![0]!, id: 'item-2', productNameZhSnapshot: '柠檬茶' },
      ],
    };
    const wrapper = mount(OrderDetailPanel, {
      props: { order: twoItemOrder, pendingAdjustmentItemId: 'item-1' },
      global: { plugins: [createPinia()] },
    });
    const buttons = wrapper.findAll('[data-testid="decrease-order-item"]');

    expect(buttons[0]?.attributes('disabled')).toBeUndefined();
    expect(buttons[0]?.text()).toContain('重试原请求');
    expect(buttons[1]?.attributes('disabled')).toBeDefined();
  });

  it('keeps an uncertain decrease on the decrease endpoint after a concurrent acceptance', async () => {
    const twoItemOrder = {
      ...tableOrder,
      status: 'ACCEPTED' as const,
      items: [
        ...tableOrder.items!,
        { ...tableOrder.items![0]!, id: 'item-2', productNameZhSnapshot: '柠檬茶' },
      ],
    };
    const wrapper = mount(OrderDetailPanel, {
      props: { order: twoItemOrder, pendingAdjustmentItemId: 'item-1' },
      global: { plugins: [createPinia()] },
    });

    const pendingRetry = wrapper.get('[data-testid="decrease-order-item"]');
    expect(pendingRetry.text()).toContain('重试原请求');
    expect(wrapper.findAll('[data-testid="return-order-item"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="return-order-item"]').attributes('disabled')).toBeDefined();
    await pendingRetry.trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
    expect(wrapper.emitted('returnItem')).toBeUndefined();
  });

});
