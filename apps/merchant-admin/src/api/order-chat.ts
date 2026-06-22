import { http } from './http';
import type {
  ApiResponse,
  MerchantOrderChatConversation,
  OrderChatMessage,
  OrderStatus,
} from '@/types/api';

export interface MerchantChatParticipant {
  id: string;
  nickname?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface MerchantChatOrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: string;
}

export interface MerchantChatConversation extends MerchantOrderChatConversation {
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
}

function buildListOrderChatMessagesParams(query: ListOrderChatMessagesQuery) {
  const params: Record<string, string | number> = {};
  if (typeof query.limit === 'number') {
    params.limit = query.limit;
  }
  if (typeof query.cursor === 'string') {
    const cursor = query.cursor.trim();
    if (cursor && cursor !== 'undefined' && cursor !== 'null') {
      params.cursor = cursor;
    }
  }
  return params;
}

export async function getMerchantOrderChat(orderId: string) {
  const response = await http.get<ApiResponse<MerchantChatConversation>>(
    `/merchant/orders/${orderId}/chat`,
  );
  return response.data.data;
}

export async function listMerchantOrderChatMessages(
  orderId: string,
  query: ListOrderChatMessagesQuery = {},
) {
  const params = buildListOrderChatMessagesParams(query);
  const response = await http.get<ApiResponse<ListOrderChatMessagesResult>>(
    `/merchant/orders/${orderId}/chat/messages`,
    { params },
  );
  return response.data.data;
}

export async function sendMerchantOrderChatMessage(
  orderId: string,
  content: string,
) {
  const response = await http.post<ApiResponse<OrderChatMessage>>(
    `/merchant/orders/${orderId}/chat/messages`,
    { content },
  );
  return response.data.data;
}

export async function markMerchantOrderChatRead(orderId: string) {
  const response = await http.post<ApiResponse<MerchantChatConversation>>(
    `/merchant/orders/${orderId}/chat/read`,
  );
  return response.data.data;
}
