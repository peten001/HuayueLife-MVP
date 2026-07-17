export type OrderStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type SettlementStatus = 'UNSETTLED' | 'SETTLED';

export type MerchantOrderAction =
  | 'accept'
  | 'reject'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';

export interface OrderItem {
  id: string;
  productId?: string | null;
  productNameZhSnapshot: string;
  productNameViSnapshot?: string | null;
  productNameEnSnapshot?: string | null;
  imageUrlSnapshot?: string | null;
  unitPriceVnd?: string;
  quantity: number;
  subtotalVnd: string;
  remark?: string | null;
}

export interface MerchantTableOrderItemInput {
  productId: string;
  quantity: number;
  remark?: string;
}

export interface CreateMerchantTableOrderInput {
  idempotencyKey: string;
  items: MerchantTableOrderItemInput[];
}

export interface DecreaseMerchantOrderItemInput {
  requestKey: string;
  expectedQuantity: number;
  targetQuantity: number;
}

export interface ReturnMerchantOrderItemInput {
  requestKey: string;
  expectedQuantity: number;
  returnQuantity: number;
}

export interface MerchantOrder {
  id: string;
  orderNo: string;
  idempotencyKey?: string;
  userId?: string | null;
  createdByStaffId?: string | null;
  merchantId: string;
  tableId?: string | null;
  tableSessionId?: string | null;
  tableNoSnapshot?: string | null;
  orderType: OrderType;
  status: OrderStatus;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryLatitude?: string | null;
  deliveryLongitude?: string | null;
  customerRemark?: string | null;
  itemAmountVnd: string;
  deliveryFeeVnd: string;
  totalAmountVnd: string;
  settlementStatus: SettlementStatus;
  acceptedAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  merchant?: { id: string; nameZh: string };
  table?: { id: string; tableNo: string; tableName?: string | null } | null;
  user?: { id: string; nickname?: string | null; phone?: string | null };
  items: OrderItem[];
  statusLogs?: OrderStatusLog[];
  chatConversation?: MerchantOrderChatConversation | null;
}

export interface OrderStatusLog {
  id: string;
  fromStatus?: OrderStatus | null;
  toStatus: OrderStatus;
  operatorType: 'USER' | 'MERCHANT_STAFF' | 'SYSTEM';
  operatorStaffId?: string | null;
  operatorStaff?: { id: string; displayName: string } | null;
  remark?: string | null;
  createdAt: string;
}

export interface MerchantOrderChatConversation {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  merchantUnreadCount: number;
  customerUnreadCount: number;
  lastMessageAt?: string | null;
  lastMessageId?: string | null;
  merchantLastReadAt?: string | null;
  customerLastReadAt?: string | null;
}

export interface MerchantOrderFilters {
  status?: OrderStatus;
  orderType?: OrderType;
  date?: string;
}
