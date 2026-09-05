import { http } from './http';
import type { ApiResponse, MerchantSettlement } from '@/types/api';

export type VoidReason = 'MISTAKE' | 'DUPLICATE' | 'TEST' | 'OTHER';
export interface OrderVoidPreview {
  target: string;
  version: string;
  settlement: MerchantSettlement;
  affectedOrderIds: string[];
  affectedOrderNos: string[];
  businessDayImpacts: Array<{
    businessDate: string; orderCount: number; grossAmountVnd: string; discountAmountVnd: string; roundingAmountVnd: string;
    netSettledAmountVnd: string; cashRevenueVnd: string; bankTransferRevenueVnd: string; unrecordedRevenueVnd: string;
  }>;
  settlementImpact: { businessDate: string; settlementCount: number; revenueVnd: string };
}
export interface OrderVoidRecord extends OrderVoidPreview {
  operationId: string; voidedAt: string; actor: { id: string; displayName: string }; reason: VoidReason; note: string | null;
}
export async function previewOrderVoid(target: string) {
  return (await http.get<ApiResponse<OrderVoidPreview | OrderVoidRecord>>(`/merchant/order-voids/${encodeURIComponent(target)}/preview`)).data.data;
}
export async function voidOrder(target: string, data: { reason: VoidReason; note: string; requestKey: string; version: string }) {
  return (await http.post<ApiResponse<OrderVoidRecord>>(`/merchant/order-voids/${encodeURIComponent(target)}`, data)).data.data;
}
export async function getOrderVoids(params: { date?: string; search?: string; page: number; pageSize: number }) {
  return (await http.get<ApiResponse<{ items: OrderVoidRecord[]; total: number; hasMore: boolean }>>('/merchant/order-voids', { params })).data.data;
}
