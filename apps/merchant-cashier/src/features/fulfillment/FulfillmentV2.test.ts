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
import PickupOrderDetail from '@/features/pickup/PickupOrderDetail.vue';
import OrderChatWorkspace from '@/features/chat/OrderChatWorkspace.vue';
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

  it('keeps the pickup status beside the fulfillment progress title', () => {
    const pickup = mount(PickupOrderDetail, { props: { order } });

    expect(pickup.find('.fulfillment-progress .status-badge').exists()).toBe(true);
    expect(pickup.find('.fulfillment-detail__header .status-badge').exists()).toBe(false);
    expect(pickup.findAll('.fulfillment-facts > div')[1]?.text()).toContain('等待时长');
    expect(pickup.find('.order-items-section__heading').text()).toContain('菜品明细');
    expect(pickup.find('.order-items-section__heading').text()).toContain('3 份');
  });

  it('uses the pickup code as the only primary detail heading', () => {
    const wrapper = mount(PickupOrderDetail, { props: { order } });

    expect(wrapper.text()).toContain('取餐码');
    expect(wrapper.text()).toContain('A018');
    expect(wrapper.text()).not.toContain('#YQ-1001');
  });

  it('keeps pickup chat compact without a duplicate detail return action', async () => {
    const wrapper = mount(OrderChatWorkspace, {
      props: { order, active: false, compactContext: true },
      global: {
        plugins: [createPinia()],
        stubs: {
          ChatMessageList: { template: '<div class="chat-message-list" />' },
          ChatComposer: { template: '<div class="chat-composer" />' },
        },
      },
    });

    expect(wrapper.find('.order-chat-workspace--compact').exists()).toBe(true);
    expect(wrapper.text()).toContain('A018');
    expect(wrapper.text()).not.toContain('查看订单');
    expect(wrapper.text()).not.toContain('#YQ-1001');
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

  it('renders pickup adjustment as the fourth action', async () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: {
        order: { ...order, roundingApplied: true, roundingAmountVnd: '3000', payableAmountVnd: '137000' },
      },
      global: { stubs: { PrintJobActions: true } },
    });

    expect(wrapper.findAll('footer > button')).toHaveLength(2);
    expect(wrapper.get('[data-testid="order-settlement-adjustment"]').text()).toContain('优惠');
    await wrapper.get('[data-testid="order-settlement-adjustment"]').trigger('click');
    expect(wrapper.emitted('adjustment')).toHaveLength(1);
  });

  it('orders pending pickup actions as reject, print, accept, then adjustment', () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: { order: { ...order, status: 'PENDING_ACCEPTANCE' } },
      slots: {
        secondary: '<button class="reject-stub">拒单</button>',
      },
      global: {
        stubs: { PrintJobActions: { template: '<button class="print-stub">打印</button>' } },
      },
    });

    expect(wrapper.findAll('footer > button').map((button) => button.text())).toEqual([
      '拒单',
      '打印',
      '接单',
      '优惠',
    ]);
  });

  it('keeps delivery pending actions in the same reject, print, accept, adjustment order', () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: { order: { ...order, orderType: 'DELIVERY', status: 'PENDING_ACCEPTANCE' } },
      slots: { secondary: '<button class="reject-stub">拒单</button>' },
      global: { stubs: { PrintJobActions: { template: '<button class="print-stub">打印</button>' } } },
    });

    expect(wrapper.findAll('footer > button').map((button) => button.text())).toEqual(['拒单', '打印', '接单', '优惠']);
  });

  it('keeps completed pickup adjustment disabled while leaving print available', () => {
    const wrapper = mount(FulfillmentActionDock, {
      props: {
        order: { ...order, status: 'COMPLETED' },
        adjustmentDisabled: true,
        adjustmentDisabledReason: '当前订单状态不允许优惠。',
      },
      global: { stubs: { PrintJobActions: true } },
    });

    expect(wrapper.get('[data-testid="order-settlement-adjustment"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="order-settlement-adjustment"]').attributes('title')).toContain('当前订单状态');
  });

  it('copies the address and exposes a safe dial action instead of copying the phone', async () => {
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
    await flushPromises();

    expect(writeText).toHaveBeenNthCalledWith(1, '12 Test Street, District 1');
    expect(wrapper.get('[data-testid="call-delivery-phone"]').text()).toContain('拨打电话');
    expect(wrapper.find('.delivery-contact-panel__phone').findAll(':scope > *').map((node) => node.element.tagName)).toEqual(['svg', 'SPAN', 'A']);
    expect(wrapper.get('[data-testid="call-delivery-phone"]').attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[data-testid="call-delivery-phone"]').attributes('title')).toContain('不支持拨号');
    expect(useUiStore().toasts).toEqual([]);
  });

  it('keeps an error prompt when copying the delivery address fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    const wrapper = mount(DeliveryContactPanel, {
      props: { order: { ...order, orderType: 'DELIVERY' } },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get('[data-testid="copy-delivery-address"]').trigger('click');
    await flushPromises();

    expect(useUiStore().toasts.map((toast) => ({
      message: toast.message,
      tone: toast.tone,
    }))).toEqual([{
      message: '无法复制地址，请手动选择复制。',
      tone: 'error',
    }]);
  });
});
