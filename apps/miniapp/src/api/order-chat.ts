import { request } from './http';
import { API_BASE_URL } from './http';
import { getToken } from '@/utils/storage';
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

function buildListOrderChatMessagesData(query: ListOrderChatMessagesQuery) {
  const data: Record<string, string | number> = {};
  if (typeof query.limit === 'number') {
    data.limit = query.limit;
  }
  if (typeof query.cursor === 'string') {
    const cursor = query.cursor.trim();
    if (cursor && cursor !== 'undefined' && cursor !== 'null') {
      data.cursor = cursor;
    }
  }
  return data;
}

export const getOrderChat = (orderId: string) =>
  request<UserChatConversation>(`/orders/${orderId}/chat`);

export const listOrderChatMessages = (
  orderId: string,
  query: ListOrderChatMessagesQuery = {},
) =>
  request<ListOrderChatMessagesResult>(`/orders/${orderId}/chat/messages`, {
    method: 'GET',
    data: buildListOrderChatMessagesData(query),
  });

export const sendOrderChatMessage = (orderId: string, content: string) =>
  request<OrderChatMessage>(`/orders/${orderId}/chat/messages`, {
    method: 'POST',
    data: { content },
  });

export const sendOrderChatLocation = (orderId: string, latitude: number, longitude: number) =>
  request<OrderChatMessage>(`/orders/${orderId}/chat/messages`, {
    method: 'POST',
    data: { messageType: 'LOCATION', latitude, longitude },
  });

export function sendOrderChatImage(orderId: string, filePath: string): Promise<OrderChatMessage> {
  const token = getToken();
  if (!token) return Promise.reject(new Error('请先登录'));
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}/orders/${orderId}/chat/images`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        try {
          const body = JSON.parse(response.data) as { data?: OrderChatMessage; message?: string | string[] };
          if (response.statusCode >= 200 && response.statusCode < 300 && body.data) {
            resolve(body.data);
            return;
          }
          reject(new Error(Array.isArray(body.message) ? body.message.join('；') : body.message || '图片发送失败'));
        } catch {
          reject(new Error('图片发送失败'));
        }
      },
      fail(error) { reject(new Error(error.errMsg || '图片发送失败')); },
    });
  });
}

export const markOrderChatRead = (orderId: string) =>
  request<UserChatConversation>(`/orders/${orderId}/chat/read`, {
    method: 'POST',
  });
