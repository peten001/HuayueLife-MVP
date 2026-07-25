import {
  createDemoChatMessage,
  listDemoChatMessages,
} from '@/fixtures/chat';
import { isDemoSessionActive } from '@/fixtures/runtime';
import type {
  MerchantOrderChatConversation,
  OrderStatus,
} from '@/types';
import { requestApi } from './http';

export interface OrderChatMessage {
  id: string;
  conversationId: string;
  orderId: string;
  senderType: 'CUSTOMER' | 'MERCHANT';
  senderId: string;
  content: string;
  readAt?: string | null;
  createdAt: string;
}

export interface MerchantChatParticipant {
  id: string;
  nickname?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface MerchantChatOrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: string;
}

export interface MerchantOrderChat extends MerchantOrderChatConversation {
  order: MerchantChatOrderSummary;
  merchant: {
    id: string;
    nameZh: string;
    logoUrl?: string | null;
  };
  customer: MerchantChatParticipant;
  lastMessage?: OrderChatMessage | null;
}

export interface ListOrderChatMessagesResult {
  items: OrderChatMessage[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface ListOrderChatMessagesQuery {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

interface ChatRequestOptions {
  signal?: AbortSignal;
}

const DEMO_MESSAGE_LIMIT = 50;

export function getMerchantOrderChat(
  orderId: string,
  options: ChatRequestOptions = {},
) {
  if (isDemoSessionActive()) return Promise.resolve(createDemoConversation(orderId));
  return requestApi<MerchantOrderChat>(
    `/merchant/orders/${encodeURIComponent(orderId)}/chat`,
    { signal: options.signal },
  );
}

export function listMerchantOrderChatMessages(
  orderId: string,
  query: ListOrderChatMessagesQuery = {},
) {
  const cursor = normalizeCursor(query.cursor);
  const limit = normalizeLimit(query.limit);
  if (isDemoSessionActive()) {
    return Promise.resolve(listDemoMessages(orderId, cursor, limit));
  }
  return requestApi<ListOrderChatMessagesResult>(
    `/merchant/orders/${encodeURIComponent(orderId)}/chat/messages`,
    {
      query: { cursor, limit },
      signal: query.signal,
    },
  );
}

export function sendMerchantOrderChatMessage(
  orderId: string,
  content: string,
  options: ChatRequestOptions = {},
) {
  if (isDemoSessionActive()) {
    return Promise.resolve(createDemoChatMessage(orderId, content));
  }
  return requestApi<OrderChatMessage>(
    `/merchant/orders/${encodeURIComponent(orderId)}/chat/messages`,
    { method: 'POST', body: { content }, signal: options.signal },
  );
}

export function markMerchantOrderChatRead(
  orderId: string,
  options: ChatRequestOptions = {},
) {
  if (isDemoSessionActive()) return Promise.resolve(createDemoConversation(orderId));
  return requestApi<MerchantOrderChat>(
    `/merchant/orders/${encodeURIComponent(orderId)}/chat/read`,
    { method: 'POST', signal: options.signal },
  );
}

function normalizeCursor(cursor?: string) {
  const normalized = cursor?.trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return undefined;
  return normalized;
}

function normalizeLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEMO_MESSAGE_LIMIT;
  return Math.min(DEMO_MESSAGE_LIMIT, Math.max(1, Math.trunc(limit ?? DEMO_MESSAGE_LIMIT)));
}

function createDemoConversation(orderId: string): MerchantOrderChat {
  const messages = listDemoChatMessages(orderId);
  const lastMessage = messages[messages.length - 1] ?? null;
  return {
    id: `demo-chat-${orderId}`,
    status: 'ACTIVE',
    merchantUnreadCount: 0,
    customerUnreadCount: 0,
    lastMessageAt: lastMessage?.createdAt ?? null,
    lastMessageId: lastMessage?.id ?? null,
    merchantLastReadAt: null,
    customerLastReadAt: null,
    order: {
      id: orderId,
      orderNo: orderId,
      status: 'ACCEPTED',
      createdAt: new Date().toISOString(),
    },
    merchant: {
      id: 'demo-merchant',
      nameZh: 'Demo',
    },
    customer: {
      id: `demo-customer-${orderId}`,
      nickname: 'Demo',
    },
    lastMessage,
  };
}

function listDemoMessages(
  orderId: string,
  cursor: string | undefined,
  limit: number,
): ListOrderChatMessagesResult {
  const all = listDemoChatMessages(orderId);
  const cursorIndex = cursor
    ? all.findIndex((message) => message.id === cursor)
    : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = all.slice(start, start + limit + 1);
  const hasMore = page.length > limit;
  const items = hasMore ? page.slice(0, limit) : page;
  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    },
  };
}
