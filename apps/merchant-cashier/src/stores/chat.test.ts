import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MerchantOrderChat,
  OrderChatMessage,
} from '@/api/order-chat';

const apiMocks = vi.hoisted(() => ({
  getMerchantOrderChat: vi.fn(),
  listMerchantOrderChatMessages: vi.fn(),
  markMerchantOrderChatRead: vi.fn(),
  sendMerchantOrderChatMessage: vi.fn(),
}));

vi.mock('@/api/order-chat', () => apiMocks);

import { mergeChatMessages, useChatStore } from './chat';

describe('cashier chat store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getMerchantOrderChat.mockReset();
    apiMocks.listMerchantOrderChatMessages.mockReset();
    apiMocks.markMerchantOrderChatRead.mockReset();
    apiMocks.sendMerchantOrderChatMessage.mockReset();
  });

  afterEach(() => {
    useChatStore().clear();
    vi.useRealTimers();
  });

  it('keeps state isolated by order and ignores a replaced request for the same order', async () => {
    const staleConversation = deferred<MerchantOrderChat>();
    const staleMessages = deferred<ReturnType<typeof messagePage>>();
    apiMocks.getMerchantOrderChat
      .mockReturnValueOnce(staleConversation.promise)
      .mockResolvedValueOnce(conversation('order-1', '2'))
      .mockResolvedValueOnce(conversation('order-2', '8'));
    apiMocks.listMerchantOrderChatMessages
      .mockReturnValueOnce(staleMessages.promise)
      .mockResolvedValueOnce(messagePage([message('2', 'order-1', 'new')]))
      .mockResolvedValueOnce(messagePage([message('8', 'order-2', 'other order')]));

    const store = useChatStore();
    const staleRefresh = store.refresh('order-1', { initial: true });
    const newestRefresh = store.refresh('order-1', { initial: true });
    const otherOrderRefresh = store.refresh('order-2', { initial: true });
    await Promise.all([newestRefresh, otherOrderRefresh]);

    staleConversation.resolve(conversation('order-1', '1'));
    staleMessages.resolve(messagePage([message('1', 'order-1', 'stale')]));
    await staleRefresh;

    expect(store.getState('order-1').messages.map((item) => item.content)).toEqual(['new']);
    expect(store.getState('order-2').messages.map((item) => item.content)).toEqual(['other order']);
    expect(store.getState('order-1').conversation?.order.id).toBe('order-1');
    expect(store.getState('order-2').conversation?.order.id).toBe('order-2');
  });

  it('follows forward cursors and de-duplicates messages in server order', async () => {
    apiMocks.getMerchantOrderChat.mockResolvedValueOnce(conversation('order-1', '3'));
    apiMocks.listMerchantOrderChatMessages
      .mockResolvedValueOnce(messagePage([
        message('2', 'order-1', 'second'),
        message('1', 'order-1', 'first'),
      ], true, '2'))
      .mockResolvedValueOnce(messagePage([
        message('2', 'order-1', 'second updated'),
        message('3', 'order-1', 'third'),
      ]));

    const store = useChatStore();
    await store.refresh('order-1', { initial: true });

    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenNthCalledWith(
      2,
      'order-1',
      expect.objectContaining({ cursor: '2', limit: 50 }),
    );
    expect(store.getState('order-1').messages.map((item) => [item.id, item.content])).toEqual([
      ['1', 'first'],
      ['2', 'second updated'],
      ['3', 'third'],
    ]);
  });

  it('merges a sent message immediately and prevents sends for final orders', async () => {
    const store = useChatStore();
    const state = store.ensureState('order-1', 'ACCEPTED');
    state.conversation = conversation('order-1', '1');
    state.messages = [message('1', 'order-1', 'customer')];
    apiMocks.sendMerchantOrderChatMessage.mockResolvedValueOnce(
      message('2', 'order-1', 'merchant reply', 'MERCHANT'),
    );

    const sent = await store.send('order-1', ' merchant reply ');

    expect(sent?.id).toBe('2');
    expect(apiMocks.sendMerchantOrderChatMessage).toHaveBeenCalledWith(
      'order-1',
      'merchant reply',
    );
    expect(state.messages.map((item) => item.id)).toEqual(['1', '2']);
    expect(state.conversation.lastMessageId).toBe('2');

    store.setOrderStatus('order-1', 'COMPLETED');
    expect(await store.send('order-1', 'blocked')).toBeNull();
    expect(apiMocks.sendMerchantOrderChatMessage).toHaveBeenCalledTimes(1);
  });

  it('marks unread messages only while that order chat is active', async () => {
    apiMocks.getMerchantOrderChat.mockResolvedValue(
      conversation('order-1', '1', { merchantUnreadCount: 1 }),
    );
    apiMocks.listMerchantOrderChatMessages.mockResolvedValue(
      messagePage([message('1', 'order-1', 'customer')]),
    );
    apiMocks.markMerchantOrderChatRead.mockResolvedValue(
      conversation('order-1', '1', { merchantUnreadCount: 0 }),
    );

    const store = useChatStore();
    await store.refresh('order-1', { initial: true });
    expect(apiMocks.markMerchantOrderChatRead).not.toHaveBeenCalled();

    await store.activate('order-1', 'ACCEPTED');
    expect(apiMocks.markMerchantOrderChatRead).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    store.deactivate('order-1');
    await store.refresh('order-1');
    expect(apiMocks.markMerchantOrderChatRead).toHaveBeenCalledTimes(1);
  });

  it('polls every five seconds in the foreground and pauses after leaving', async () => {
    vi.useFakeTimers();
    apiMocks.getMerchantOrderChat.mockResolvedValue(conversation('order-1', null));
    apiMocks.listMerchantOrderChatMessages.mockResolvedValue(messagePage([]));
    const store = useChatStore();

    await store.activate('order-1', 'ACCEPTED');
    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenCalledTimes(2);

    store.deactivate('order-1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenCalledTimes(2);
  });

  it('pauses polling while the document is hidden and refreshes on return', async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    apiMocks.getMerchantOrderChat.mockResolvedValue(conversation('order-1', null));
    apiMocks.listMerchantOrderChatMessages.mockResolvedValue(messagePage([]));
    const store = useChatStore();

    await store.activate('order-1', 'ACCEPTED');
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(apiMocks.listMerchantOrderChatMessages).toHaveBeenCalledTimes(2);
  });
});

describe('mergeChatMessages', () => {
  it('sorts numeric identifiers without failing on non-numeric demo identifiers', () => {
    const result = mergeChatMessages(
      [message('demo-2', 'order-1', 'later')],
      [message('10', 'order-1', 'ten'), message('2', 'order-1', 'two')],
    );
    expect(result.map((item) => item.id)).toEqual(['2', '10', 'demo-2']);
  });
});

function conversation(
  orderId: string,
  lastMessageId: string | null,
  overrides: Partial<MerchantOrderChat> = {},
): MerchantOrderChat {
  return {
    id: `conversation-${orderId}`,
    status: 'ACTIVE',
    merchantUnreadCount: 0,
    customerUnreadCount: 0,
    lastMessageAt: lastMessageId ? '2026-07-24T01:00:00.000Z' : null,
    lastMessageId,
    merchantLastReadAt: null,
    customerLastReadAt: null,
    order: {
      id: orderId,
      orderNo: `NO-${orderId}`,
      status: 'ACCEPTED',
      createdAt: '2026-07-24T00:00:00.000Z',
    },
    merchant: { id: 'merchant-1', nameZh: 'Merchant' },
    customer: { id: 'customer-1', nickname: 'Customer' },
    lastMessage: null,
    ...overrides,
  };
}

function message(
  id: string,
  orderId: string,
  content: string,
  senderType: OrderChatMessage['senderType'] = 'CUSTOMER',
): OrderChatMessage {
  return {
    id,
    conversationId: `conversation-${orderId}`,
    orderId,
    senderType,
    senderId: senderType === 'CUSTOMER' ? 'customer-1' : 'staff-1',
    content,
    readAt: null,
    createdAt: id.startsWith('demo')
      ? '2026-07-24T01:00:00.000Z'
      : `2026-07-24T00:00:${String(Number(id)).padStart(2, '0')}.000Z`,
  };
}

function messagePage(
  items: OrderChatMessage[],
  hasMore = false,
  nextCursor: string | null = null,
) {
  return { items, pageInfo: { hasMore, nextCursor } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
