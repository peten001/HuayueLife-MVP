import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type {
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
} from '@/types';
import { requestApi } from './http';

export function listMerchantOrders(filters: MerchantOrderFilters = {}): Promise<MerchantOrder[]> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.orders(filters))
    : requestApi<MerchantOrder[]>('/merchant/orders', {
      query: {
        status: filters.status,
        orderType: filters.orderType,
        date: filters.date,
      },
    });
}

export function getMerchantOrder(id: string): Promise<MerchantOrder> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.order(id))
    : requestApi<MerchantOrder>(`/merchant/orders/${encodeURIComponent(id)}`);
}

export function runMerchantOrderAction(
  id: string,
  action: MerchantOrderAction,
  reason?: string,
): Promise<MerchantOrder> {
  if (isDemoSessionActive()) {
    return Promise.resolve(demoRepository.runOrderAction(id, action));
  }
  return requestApi<MerchantOrder>(
    `/merchant/orders/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      body: action === 'reject' ? { reason: reason?.trim() || undefined } : {},
    },
  );
}
