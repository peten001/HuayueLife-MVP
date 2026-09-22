import { createPinia, setActivePinia } from 'pinia';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantOrder } from '@/types';
import { setLocale } from '@/i18n';
import OrderChatWorkspace from './OrderChatWorkspace.vue';

const apiMocks = vi.hoisted(() => ({
  getMerchantOrderChat: vi.fn(),
  listMerchantOrderChatMessages: vi.fn(),
  markMerchantOrderChatRead: vi.fn(),
  sendMerchantOrderChatMessage: vi.fn(),
  sendMerchantOrderChatImage: vi.fn(),
  sendMerchantOrderChatLocation: vi.fn(),
}));

vi.mock('@/api/order-chat', () => ({
  ...apiMocks,
}));

const order = {
  id: 'order-location-test',
  orderNo: 'YQ-LOCATION',
  merchantId: 'merchant-1',
  userId: 'customer-1',
  orderType: 'DELIVERY',
  status: 'ACCEPTED',
  itemAmountVnd: '10000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '10000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-09-22T06:00:00.000Z',
  updatedAt: '2026-09-22T06:00:00.000Z',
  items: [],
} as MerchantOrder;

function conversation() {
  return {
    id: 'conversation-1',
    status: 'ACTIVE' as const,
    merchantUnreadCount: 0,
    customerUnreadCount: 0,
    lastMessageAt: null,
    lastMessageId: null,
    merchantLastReadAt: null,
    customerLastReadAt: null,
    order: {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      createdAt: order.createdAt,
    },
    merchant: { id: 'merchant-1', nameZh: 'Test' },
    customer: { id: 'customer-1', nickname: 'Customer' },
    lastMessage: null,
  };
}

describe('OrderChatWorkspace location confirmation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setLocale('zh');
    vi.clearAllMocks();
    apiMocks.getMerchantOrderChat.mockResolvedValue(conversation());
    apiMocks.listMerchantOrderChatMessages.mockResolvedValue({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    apiMocks.markMerchantOrderChatRead.mockResolvedValue(conversation());
    apiMocks.sendMerchantOrderChatLocation.mockResolvedValue({
      id: 'location-message-1',
      conversationId: 'conversation-1',
      orderId: order.id,
      senderType: 'MERCHANT',
      senderId: 'merchant-1',
      content: '[位置]',
      messageType: 'LOCATION',
      latitude: 21.1862,
      longitude: 106.0763,
      createdAt: '2026-09-22T06:01:00.000Z',
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({
          coords: {
            latitude: 21.1862,
            longitude: 106.0763,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        }),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    setLocale('zh');
  });

  it('previews the current location before sending it', async () => {
    const wrapper = mount(OrderChatWorkspace, {
      attachTo: document.body,
      props: { order, active: true, compactContext: true },
      global: {
        plugins: [createPinia()],
        stubs: {
          ChatMessageList: {
            template: '<div class="chat-message-list" />',
            methods: { scrollToBottom: vi.fn() },
          },
          ChatComposer: {
            emits: ['location'],
            template: '<button class="request-location" type="button" @click="$emit(\'location\')">location</button>',
            methods: { blur: vi.fn(), focus: vi.fn() },
          },
        },
      },
    });

    await wrapper.get('.request-location').trigger('click');
    await flushPromises();

    const sheet = new DOMWrapper(document.body.querySelector('.location-confirm-sheet') as Element);
    expect(sheet.text()).toContain('确认发送此位置？');
    expect(sheet.text()).toContain('21.18620, 106.07630');
    expect(apiMocks.sendMerchantOrderChatLocation).not.toHaveBeenCalled();

    await new DOMWrapper(document.body.querySelector('.location-confirm-sheet__send') as Element).trigger('click');
    await flushPromises();

    expect(apiMocks.sendMerchantOrderChatLocation).toHaveBeenCalledWith(order.id, 21.1862, 106.0763);
    expect(document.body.querySelector('.location-confirm-sheet')).toBeNull();
    wrapper.unmount();
  });
});
