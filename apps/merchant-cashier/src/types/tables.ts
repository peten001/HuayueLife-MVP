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
  originalAmountVnd?: string;
  discountPayableRateBps?: number | null;
  discountAmountVnd?: string;
  discountAppliedByStaffId?: string | null;
  discountAppliedAt?: string | null;
  roundingApplied?: boolean;
  roundingAmountVnd?: string;
  payableAmountVnd?: string;
  latestOrderAt?: string | null;
  pendingOrderCount: number;
  unfinishedOrderCount: number;
}

export interface TableSessionOrderItem {
  id: string;
  productId?: string | null;
  productNameZhSnapshot: string;
  productNameViSnapshot?: string | null;
  productNameEnSnapshot?: string | null;
  productNameZh?: string | null;
  productNameVi?: string | null;
  productNameEn?: string | null;
  quantity: number;
  unitPriceVnd: string;
  subtotalVnd: string;
  remark?: string | null;
}

export interface TableSessionOrder {
  id: string;
  orderNo: string;
  createdByStaffId?: string | null;
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

export interface TableSessionCheckoutResult {
  session: TableSessionDetail;
  orders: MerchantOrder[];
}

export interface DineInCanonicalLine {
  lineKey: string;
  productId: string | null;
  productNameZh: string;
  productNameVi?: string | null;
  productNameEn?: string | null;
  remark: string;
  optionSignature: string;
  activeSince: string;
  displayOrderKey: string;
  unitPriceVnd: string;
  quantity: number;
  lockedQuantity: number;
  adjustableQuantity: number;
  subtotalVnd: string;
  adjustability: 'DECREASE' | 'RETURN' | 'LOCKED';
  sourceSummary: {
    staffQuantity: number;
    qrQuantity: number;
  };
}

export interface DineInCanonicalState {
  sessionId: string;
  tableId: string;
  tableNo: string;
  tableName?: string | null;
  openedAt: string;
  sessionStatus: TableSessionStatus;
  revision: string;
  items: DineInCanonicalLine[];
  totals: {
    originalAmountVnd: string;
    discountPayableRateBps: number | null;
    discountAmountVnd: string;
    roundingAmountVnd: string;
    payableAmountVnd: string;
  };
  blockers: string[];
  productionNotification?: ProductionNotificationState;
  generatedAt: string;
  idempotentReplay?: boolean;
  appliedRevision?: string;
  releasedBecause?: 'EMPTY_AFTER_RECONCILE';
}

export interface ProductionNotificationState {
  status: 'READY' | 'UP_TO_DATE' | 'UNCONFIGURED' | 'UNAVAILABLE';
  pendingItemQuantity: number;
  pendingOrderCount: number;
  configuredDestinationCount: number;
}

export interface ProductionNotificationResult {
  notification: ProductionNotificationState;
  queuedItemQuantity: number;
  queuedOrderCount: number;
  queuedDestinationCount: number;
  idempotentReplay: boolean;
}

export interface ReconcileDineInCanonicalStateInput {
  requestKey: string;
  baseRevision: string;
  desiredItems: Array<{
    lineKey?: string;
    productId?: string;
    remark?: string;
    desiredQuantity: number;
  }>;
}

export interface ReleaseEmptyTableSessionInput {
  requestKey: string;
  expectedRevision: string;
}

export interface CheckoutTableSessionV2Input {
  expectedRevision: string;
  requestKey: string;
}

export interface TransferTableSessionInput {
  targetTableId: string;
  expectedSourceTableId: string;
  requestKey: string;
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
