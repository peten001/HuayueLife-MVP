import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { setLocale } from '@/i18n';
import { useUiStore } from '@/stores';
import type { MerchantOrder } from '@/types';
import DeliveryContactPanel from '@/features/delivery/DeliveryContactPanel.vue';
import DeliveryOrderCard from '@/features/delivery/DeliveryOrderCard.vue';
import PickupOrderCard from '@/features/pickup/PickupOrderCard.vue';
import OrderItemsSection from './OrderItemsSection.vue';
import FulfillmentActionDock from './FulfillmentActionDock.vue';
import FulfillmentProgressRail from './FulfillmentProgressRail.vue';

const order: MerchantOrder = {
  id: 'order-1',
  orderNo: 'YQ-1001',
  merchantId: 'merchant-1',
  userId: 'customer-1',
  orderType: 'PICKUP',
  status: 'ACCEPTED',
  contactName: 'Test Customer',
  contactPhone: '0912345678',
  deliveryAddress: '12 Test Street, District 1',
  customerRemark: 'Leave at reception',
  pickupCode: 'A018',
  estimatedReadyAt: '2026-07-24T02:30:00.000Z',
  itemAmountVnd: '125000',
  deliveryFeeVnd: '15000',
  totalAmountVnd: '140000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-24T02:00:00.000Z',
  updatedAt: '2026-07-24T02:05:00.000Z',
  items: [
    {
      id: 'item-1',
      productNameZhSnapshot: '牛肉粉',
      productNameViSnapshot: 'Phở bò',
      productNameEnSnapshot: 'Beef pho',
      unitPriceVnd: '45000',
      quantity: 2,
      subtotalVnd: '90000',
    },
    {
      id: 'item-2',
      productNameZhSnapshot: '咖啡',
      unitPriceVnd: '35000',
      quantity: 1,
      subtotalVnd: '35000',
    },
  ],
  chatConversation: {
    id: 'chat-1',
    status: 'ACTIVE',
    merchantUnreadCount: 2,
    customerUnreadCount: 0,
  },
};

describe('cashier fulfilment V2 components', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setLocale('zh');
  });

  afterEach(() => {
    setLocale('zh');
    vi.restoreAllMocks();
  });

  it('renders the explicit total item count and required compact list fields', () => {
    const pickup = mount(PickupOrderCard, { props: { order } });
    const delivery = mount(DeliveryOrderCard, {
      props: { order: { ...order, orderType: 'DELIVERY' } },
    });

    for (const wrapper of [pickup, delivery]) {
      expect(wrapper.text()).toContain('共 3 份');
      expect(wrapper.text()).toContain('091****678');
      expect(wrapper.text()).toContain('140,000 VND');
      expect(wrapper.text()).toContain('2');
    }
    expect(pickup.text()).toContain('A018');
    expect(delivery.text()).toContain('12 Test Street');
    expect(delivery.text()).toContain('Leave at reception');
  });

  it('shows quantity, server unit price, subtotal and localized item names', async () => {
    const wrapper = mount(OrderItemsSection, { props: { order } });
    expect(wrapper.text()).toContain('牛肉粉');
    expect(wrapper.text()).toContain('× 2');
    expect(wrapper.text()).toContain('单价 45,000 VND');
    expect(wrapper.text()).toContain('90,000 VND');

    setLocale('vi');
    await nextTick();
    expect(wrapper.text()).toContain('Phở bò');
    expect(wrapper.text()).toContain('Đơn giá 45.000 ₫');
  });

  it('collapses the internal ACCEPTED state into the user-visible preparing step', () => {
    const pickup = mount(FulfillmentProgressRail, { props: { order } });
    const delivery = mount(FulfillmentProgressRail, {
      props: { order: { ...order, orderType: 'DELIVERY' } },
    });

    expect(pickup.findAll('li')).toHaveLength(4);
    expect(delivery.findAll('li')).toHaveLength(5);
    expect(pickup.text()).not.toContain('已接单');
    expect(pickup.get('li.is-current').text()).toContain('制作中');
  });

  it('offers preparation completion directly for a recoverable ACCEPTED snapshot', async () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: { order },
      global: { stubs: { PrintJobActions: true } },
    });

    expect(wrapper.text()).toContain('制作完成');
    expect(wrapper.text()).not.toContain('开始制作');
    await wrapper.get('.primary-action').trigger('click');
    expect(wrapper.emitted('action')).toEqual([['finish-preparing']]);
  });

  it('copies both the full address and phone and reports localized success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(DeliveryContactPanel, {
      props: { order: { ...order, orderType: 'DELIVERY' } },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get('[data-testid="copy-delivery-address"]').trigger('click');
    await wrapper.get('[data-testid="copy-delivery-phone"]').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenNthCalledWith(1, '12 Test Street, District 1');
    expect(writeText).toHaveBeenNthCalledWith(2, '0912345678');
    expect(useUiStore().toasts.map((toast) => toast.message)).toEqual([
      '地址已复制。',
      '电话已复制。',
    ]);
  });
});
