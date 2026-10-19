export type KdsAction = 'START' | 'MAKE' | 'SERVE' | 'URGE';
export type KdsOrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export interface KdsSettings {
  enabled: boolean; timeoutMinutes: number; stations: string[];
  servingEnabled?: boolean;
  categoryRoutes: { categoryId: string; station: string }[];
}
export interface KdsOrder {
  id: string; orderNo: string; orderType: KdsOrderType; status: string;
  tableNo: string | null; customerRemark: string | null; createdAt: string;
  tableSessionId?: string | null;
  isReservation?: boolean;
  scheduledFor?: string | null;
  kdsPackedAt: string | null; pickupCode: string | null;
  items: { id: string; quantity: number; productNameZhSnapshot: string }[];
}
export interface KdsTask {
  id: string; orderId: string; orderItemId: string; productId: string | null;
  menuThumbnailUrl?: string | null;
  dishNameVi?: string | null; dishNameEn?: string | null;
  dishName: string; unit: string; remark: string | null; station: string; quantity: number;
  madeQuantity: number; servedQuantity: number; cancelledQuantity: number;
  returnedMadeQuantity?: number; returnedServedQuantity?: number;
  version: number; startedAt: string | null; urgentAt: string | null; createdAt: string;
  order: KdsOrder;
}
export interface KdsLine { taskId: string; version: number; quantity: number }
export interface KdsOperation {
  id: string; staffId: string | null; kind: string; reversedAt: string | null; createdAt: string;
  lines: { taskId: string; orderId: string; dishName: string; dishNameVi?: string | null; dishNameEn?: string | null; unit?: string; quantity: number; reason?: string; removedMade?: number; removedServed?: number; station?: string; orderNo?: string; tableNo?: string | null; orderType?: string }[];
}
export interface KdsBoard {
  settings: KdsSettings; tasks: KdsTask[]; operations: KdsOperation[];
  categories: { id: string; nameZh: string; nameVi?: string | null; nameEn?: string | null }[]; serverTime: string;
}
