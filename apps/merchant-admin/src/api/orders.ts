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

export interface MerchantOrderSummaryBucket {
  count: number;
  amountVnd: string;
}

export interface MerchantOrderCompletedBucket extends MerchantOrderSummaryBucket {
  grossAmountVnd: string;
  discountAmountVnd: string;
  roundingAmountVnd: string;
  cashRevenueVnd: string;
  bankTransferRevenueVnd: string;
  unrecordedRevenueVnd: string;
}

export type MerchantOrderSummary = Record<
  'ALL' | 'DINE_IN' | 'PICKUP' | 'DELIVERY' | 'ABNORMAL',
  MerchantOrderSummaryBucket
> & {
  COMPLETED: MerchantOrderCompletedBucket;
  statusBreakdown: Record<string, number>;
};

export interface BusinessDaySummary {
  businessDate: string;
  orderCount: number;
  totalRevenueVnd: string;
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

export async function getMerchantOrderSummary(filters: OrderFilters = {}) {
  const response = await http.get<ApiResponse<MerchantOrderSummary>>(
    '/merchant/orders/summary',
    {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => Boolean(value)),
      ),
    },
  );
  return response.data.data;
}

export async function getBusinessDaySummary() {
  const response = await http.get<ApiResponse<BusinessDaySummary>>(
    '/merchant/orders/business-day-summary',
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

export async function printMerchantOrder(id: string, printerIds?: string[]) {
  const response = await http.post<ApiResponse<{
    skipped?: boolean;
    total: number;
    successCount: number;
    failedCount: number;
    results: Array<{
      printerId: string;
      printerName: string;
      success: boolean;
      errorMessage?: string;
    }>;
  }>>(`/merchant/orders/${id}/print`, { printerIds });
  return response.data.data;
}
