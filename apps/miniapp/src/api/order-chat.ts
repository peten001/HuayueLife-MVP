import { request } from './http';
import type {
  OrderChatMessage,
  OrderStatus,
  UserOrderChatConversation,
} from '@/types/api';

export interface UserChatOrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: string;
}

export interface UserChatConversation extends UserOrderChatConversation {
  order: UserChatOrderSummary;
  merchant: {
    id: string;
    nameZh: string;
    nameVi?: string;
    logoUrl?: string;
  };
  customer: {
    id: string;
    nickname?: string;
    phone?: string;
    avatarUrl?: string;
  };
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
}

export const getOrderChat = (orderId: string) =>
  request<UserChatConversation>(`/orders/${orderId}/chat`);

export const listOrderChatMessages = (
  orderId: string,
  query: ListOrderChatMessagesQuery = {},
) =>
  request<ListOrderChatMessagesResult>(`/orders/${orderId}/chat/messages`, {
    method: 'GET',
    data: query,
  });

export const sendOrderChatMessage = (orderId: string, content: string) =>
  request<OrderChatMessage>(`/orders/${orderId}/chat/messages`, {
    method: 'POST',
    data: { content },
  });

export const markOrderChatRead = (orderId: string) =>
  request<UserChatConversation>(`/orders/${orderId}/chat/read`, {
    method: 'POST',
  });
