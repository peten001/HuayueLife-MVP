export type CashierOrderStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';

export type CashierOrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';

export type CashierOrderAction =
  | 'accept'
  | 'reject'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';

export interface CashierOrderItemView {
  id: string;
  productNameZhSnapshot?: string;
  productNameViSnapshot?: string | null;
  productNameEnSnapshot?: string | null;
  imageUrlSnapshot?: string | null;
  quantity?: number;
  unitPriceVnd?: string | number;
  subtotalVnd?: string | number;
  remark?: string | null;
}

export interface CashierOrderView {
  id: string;
  orderNo?: string;
  orderType?: CashierOrderType;
  status?: CashierOrderStatus;
  tableNoSnapshot?: string | null;
  createdAt?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  customerRemark?: string | null;
  itemAmountVnd?: string | number;
  deliveryFeeVnd?: string | number;
  totalAmountVnd?: string | number;
  settlementStatus?: 'UNSETTLED' | 'SETTLED';
  table?: {
    id?: string;
    tableNo?: string;
    tableName?: string | null;
  } | null;
  items?: CashierOrderItemView[];
}

export interface CashierTableSessionSummaryView {
  id: string;
  sessionNo?: string;
  tableId?: string;
  tableNo?: string;
  tableName?: string | null;
  status?: 'OPEN' | 'CLOSED';
  openedAt?: string;
  orderCount?: number;
  itemCount?: number;
  totalAmountVnd?: string | number;
  pendingOrderCount?: number;
  unfinishedOrderCount?: number;
}

export interface CashierTableView {
  id: string;
  tableNo?: string;
  tableName?: string | null;
  status?: 'ACTIVE' | 'DISABLED';
  currentSession?: CashierTableSessionSummaryView | null;
  operationalStatus?: 'AVAILABLE' | 'IN_USE' | 'READY_TO_CLOSE' | 'DISABLED';
}

export interface CashierTableSessionDetailView extends CashierTableSessionSummaryView {
  orders?: CashierOrderView[];
}

export function tableLabel(order?: CashierOrderView | null) {
  return order?.tableNoSnapshot || order?.table?.tableNo || '';
}

export function elapsedDuration(value?: string | null, maxHours = 18) {
  if (!value) return null;
  const startedAt = new Date(value).getTime();
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 0) return { abnormal: true, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  return {
    abnormal: hours >= maxHours,
    hours,
    minutes: totalMinutes % 60,
  };
}
