import { http } from './http';
import type {
  ApiResponse,
  MerchantOrder,
  OrderStatus,
  OrderType,
} from '@/types/api';

export interface OrderFilters {
  status?: OrderStatus | '';
  orderType?: OrderType | '';
  date?: string;
}

export async function getMerchantOrders(filters: OrderFilters = {}) {
  const response = await http.get<ApiResponse<MerchantOrder[]>>(
    '/merchant/orders',
    {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => Boolean(value)),
      ),
    },
  );
  return response.data.data;
}

export async function getMerchantOrder(id: string) {
  const response = await http.get<ApiResponse<MerchantOrder>>(
    `/merchant/orders/${id}`,
  );
  return response.data.data;
}

export async function runOrderAction(
  id: string,
  action:
    | 'accept'
    | 'reject'
    | 'start-preparing'
    | 'ready'
    | 'start-delivery'
    | 'complete'
    | 'settle',
  payload?: Record<string, unknown>,
) {
  const response = await http.post<ApiResponse<MerchantOrder>>(
    `/merchant/orders/${id}/${action}`,
    payload ?? {},
  );
  return response.data.data;
}
