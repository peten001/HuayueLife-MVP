import type { MerchantOrder, OrderStatus } from './orders';

export interface DiningTable {
  id: string;
  merchantId: string;
  tableNo: string;
  tableName?: string | null;
  qrToken: string;
  qrVersion: number;
  status: 'ACTIVE' | 'DISABLED';
  createdAt?: string;
  updatedAt?: string;
}

export type TableSessionStatus = 'OPEN' | 'CLOSED';

export interface TableSessionSummary {
  id: string;
  sessionNo: string;
  merchantId: string;
  tableId: string;
  tableNo: string;
  tableName?: string | null;
  status: TableSessionStatus;
  openedAt: string;
  closedAt?: string | null;
  orderCount: number;
  itemCount: number;
  totalAmountVnd: string;
  latestOrderAt?: string | null;
  pendingOrderCount: number;
  unfinishedOrderCount: number;
}

export interface TableSessionOrderItem {
  id: string;
  productNameZhSnapshot: string;
  quantity: number;
  unitPriceVnd: string;
  subtotalVnd: string;
}

export interface TableSessionOrder {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: string;
  itemAmountVnd: string;
  deliveryFeeVnd: string;
  totalAmountVnd: string;
  tableNoSnapshot?: string | null;
  items: TableSessionOrderItem[];
}

export interface TableSessionDetail extends TableSessionSummary {
  orders: TableSessionOrder[];
}

export interface MerchantOrderMutationResult {
  order: MerchantOrder | null;
  session: TableSessionDetail;
}

export type TableOperationalStatus =
  | 'AVAILABLE'
  | 'IN_USE'
  | 'DISABLED';

export interface TableCardView extends DiningTable {
  currentSession: TableSessionSummary | null;
  operationalStatus: TableOperationalStatus;
  canCloseSession: boolean;
}
