import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type {
  CreateMerchantTableOrderInput,
  DecreaseMerchantOrderItemInput,
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
  MerchantOrderMutationResult,
  ReturnMerchantOrderItemInput,
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

export function createMerchantTableOrder(
  tableId: string,
  input: CreateMerchantTableOrderInput,
): Promise<MerchantOrderMutationResult> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.createTableOrder(tableId, input))
    : requestApi<MerchantOrderMutationResult>(
      `/merchant/tables/${encodeURIComponent(tableId)}/orders`,
      { method: 'POST', body: input },
    );
}

export function decreaseMerchantOrderItem(
  orderId: string,
  itemId: string,
  input: DecreaseMerchantOrderItemInput,
): Promise<MerchantOrderMutationResult> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.decreaseOrderItem(orderId, itemId, input))
    : requestApi<MerchantOrderMutationResult>(
      `/merchant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/quantity`,
      { method: 'PATCH', body: input },
    );
}

export function returnMerchantOrderItem(
  orderId: string,
  itemId: string,
  input: ReturnMerchantOrderItemInput,
): Promise<MerchantOrderMutationResult> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.returnOrderItem(orderId, itemId, input))
    : requestApi<MerchantOrderMutationResult>(
      `/merchant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/return`,
      { method: 'POST', body: input },
    );
}
