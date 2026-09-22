import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatMessageList from './ChatMessageList.vue';
import type { OrderChatMessage } from '@/api/order-chat';

function message(id: string, content: string): OrderChatMessage {
  return {
    id, conversationId: '1', orderId: '2', senderType: 'CUSTOMER', senderId: '3',
    content, createdAt: '2026-09-21T00:00:00.000Z',
  };
}

describe('ChatMessageList attachments', () => {
  it('renders old text and new image/location messages in one timeline', () => {
    const wrapper = mount(ChatMessageList, {
      props: {
        messages: [
          message('1', 'Hello'),
          { ...message('2', '[图片]'), messageType: 'IMAGE', mediaUrl: '/uploads/chat/test.webp' },
          { ...message('3', '[位置]'), messageType: 'LOCATION', latitude: 21.1862, longitude: 106.0763 },
        ],
        loading: false, refreshing: false, hasMore: false,
      },
    });

    expect(wrapper.text()).toContain('Hello');
    expect(wrapper.find('img').attributes('src')).toContain('/uploads/chat/test.webp');
    expect(wrapper.find('a[href^="https://www.google.com/maps?q="]').attributes('href'))
      .toBe('https://www.google.com/maps?q=21.1862,106.0763');
    expect(wrapper.text()).toContain('21.18620, 106.07630');
  });

  it('keeps background polling silent so the chat layout does not flash', () => {
    const wrapper = mount(ChatMessageList, {
      props: {
        messages: [message('1', 'Hello')],
        loading: false,
        refreshing: true,
        hasMore: false,
      },
    });

    expect(wrapper.find('.chat-message-list__toolbar').exists()).toBe(false);
    expect(wrapper.text()).toContain('Hello');
  });
});
