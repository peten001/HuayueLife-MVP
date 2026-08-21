import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type {
  CreateMerchantTableOrderInput,
  DecreaseMerchantOrderItemInput,
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
  MerchantOrderMutationResult,
  MerchantSettlement,
  MerchantSettlementFilters,
  MerchantSettlementPage,
  ReturnMerchantOrderItemInput,
  SettlementAdjustmentInput,
  PaymentMethod,
  BusinessDaySummary,
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

export function listMerchantSettlements(
  filters: MerchantSettlementFilters = {},
): Promise<MerchantSettlementPage> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.settlements(filters))
    : requestApi<MerchantSettlementPage>('/merchant/settlements', {
        query: {
          status: filters.status,
          orderType: filters.orderType,
          date: filters.date,
          search: filters.search,
          page: filters.page,
          pageSize: filters.pageSize,
        },
      });
}

export function getMerchantSettlement(id: string): Promise<MerchantSettlement> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.settlement(id))
    : requestApi<MerchantSettlement>(
        `/merchant/settlements/${encodeURIComponent(id)}`,
      );
}

export function getBusinessDaySummary(businessDate?: string): Promise<BusinessDaySummary> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.businessDaySummary(businessDate))
    : requestApi<BusinessDaySummary>('/merchant/orders/business-day-summary', {
      query: { businessDate },
    });
}

export function printBusinessDaySummary(businessDate: string, requestKey: string) {
  if (isDemoSessionActive()) {
    return Promise.resolve({
      job: { id: `demo-summary-${requestKey}` },
      summary: demoRepository.businessDaySummary(businessDate),
    });
  }
  return requestApi<{ job: { id: string }; summary: BusinessDaySummary }>(
    '/merchant/orders/business-day-summary/print',
    { method: 'POST', body: { businessDate, requestKey } },
  );
}

export function setMerchantOrderSettlementAdjustment(
  id: string,
  input: SettlementAdjustmentInput,
): Promise<MerchantOrder> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.setOrderSettlementAdjustment(id, input))
    : requestApi<MerchantOrder>(
      `/merchant/orders/${encodeURIComponent(id)}/settlement-adjustment`,
      { method: 'POST', body: input },
    );
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
  paymentMethod?: PaymentMethod,
): Promise<MerchantOrder> {
  if (isDemoSessionActive()) {
    return Promise.resolve(demoRepository.runOrderAction(id, action));
  }
  return requestApi<MerchantOrder>(
    `/merchant/orders/${encodeURIComponent(id)}/${action === 'complete' ? 'cashier-complete' : action}`,
    {
      method: 'POST',
      body: action === 'reject'
        ? { reason: reason?.trim() || undefined }
        : action === 'complete'
          ? { paymentMethod }
          : {},
    },
  );
}

export function setMerchantOrderRounding(
  id: string,
  enabled: boolean,
): Promise<MerchantOrder> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.setOrderRounding(id, enabled))
    : requestApi<MerchantOrder>(
      `/merchant/orders/${encodeURIComponent(id)}/rounding`,
      { method: 'POST', body: { enabled } },
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
