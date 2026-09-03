import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';

/**
 * Canonical merchant Settlement Read Model.
 *
 * Merchant-facing views (Cashier history, Merchant Admin orders/history and
 * analytics financial facts) must all derive from this single builder so the
 * grouping rule is implemented exactly once:
 *
 *   DINE_IN + COMPLETED + closed tableSessionId  -> 1 TABLE_SESSION settlement
 *   PICKUP / DELIVERY COMPLETED                  -> 1 ORDER settlement
 *   DINE_IN with missing/invalid/untrusted session -> raw ORDER fallback
 *   CANCELLED                                    -> raw ORDER fallback record
 *
 * The raw Order rows are never merged, mutated or deleted; this module only
 * produces a read-only view. Financial truth for a closed session comes from
 * the persisted TableSession row (discountAmountVnd / roundingAmountVnd /
 * paymentMethod / closedAt / businessDate), never from duplicated
 * TABLE_SESSION_CHECKOUT status-log metadata. Duplicated logs are treated as
 * the same checkout evidence; conflicting logs are recorded as invariant
 * violations while the persisted session values remain the UI truth.
 */

export const SETTLEMENT_VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

export type SettlementSessionRow = {
  id: bigint;
  status: string;
  closedAt: Date | null;
  businessDate: Date | null;
  paymentMethod: PaymentMethod | null;
  discountAmountVnd: bigint | number;
  roundingAmountVnd: bigint | number;
};

export type SettlementTableRow = {
  id: bigint;
  tableNo: string;
  tableName: string | null;
};

export type SettlementItemRow = {
  id: bigint;
  productId: bigint | null;
  productNameZhSnapshot: string;
  imageUrlSnapshot: string | null;
  unitPriceVnd: bigint | number;
  quantity: number;
  subtotalVnd: bigint | number;
  remark: string | null;
  product?: {
    nameZh?: string | null;
    nameVi?: string | null;
    nameEn?: string | null;
  } | null;
};

export type SettlementCheckoutLogRow = {
  originalAmountVnd?: string | null;
  discountAmountVnd?: string | null;
  roundingAmountVnd?: string | null;
  finalPayableAmountVnd?: string | null;
  payableAmountVnd?: string | null;
  paymentMethod?: string | null;
};

export type SettlementOrderRow = {
  id: bigint;
  orderNo: string;
  status: OrderStatus;
  orderType: OrderType;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  updatedAt?: Date;
  businessDate: Date | null;
  totalAmountVnd: bigint | number;
  itemAmountVnd?: bigint | number;
  deliveryFeeVnd?: bigint | number;
  discountPayableRateBps: number | null;
  discountAmountVnd: bigint | number | null;
  roundingAmountVnd: bigint | number | null;
  paymentMethod: PaymentMethod | null;
  tableId: bigint | null;
  tableSessionId: bigint | null;
  tableNoSnapshot: string | null;
  tableSession: SettlementSessionRow | null;
  table: SettlementTableRow | null;
  items?: SettlementItemRow[];
  /** Duplicated TABLE_SESSION_CHECKOUT evidence carried by this child order. */
  checkoutLogs?: SettlementCheckoutLogRow[];
};

export interface MerchantSettlementItem {
  id: string;
  productId: string | null;
  productNameZh: string;
  productNameVi: string | null;
  productNameEn: string | null;
  imageUrl: string | null;
  unitPriceVnd: string;
  quantity: number;
  subtotalVnd: string;
  remark: string | null;
}

export interface MerchantSettlementSourceOrder {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  totalAmountVnd: string;
  paymentMethod: PaymentMethod | null;
}

export interface MerchantSettlement {
  settlementId: string;
  kind: 'TABLE_SESSION' | 'ORDER';
  orderType: OrderType;
  status: OrderStatus;
  businessDate: string;
  settledAt: string;
  tableSessionId: string | null;
  tableId: string | null;
  tableName: string | null;
  orderIds: string[];
  orderNos: string[];
  orderCount: number;
  itemQuantity: number;
  items: MerchantSettlementItem[];
  originalAmountVnd: string;
  discountAmountVnd: string;
  roundingAmountVnd: string;
  finalReceivableVnd: string;
  paymentMethod: PaymentMethod | null;
  sourceOrders: MerchantSettlementSourceOrder[];
  invariantViolations: string[];
}

export interface MerchantSettlementFact {
  settlementId: string;
  kind: 'TABLE_SESSION' | 'ORDER';
  orderType: OrderType;
  businessDate: string;
  settledAt: Date;
  originalAmountVnd: bigint;
  discountAmountVnd: bigint;
  roundingAmountVnd: bigint;
  finalRevenueVnd: bigint;
  paymentMethod: PaymentMethod | null;
  orderCount: number;
  tableSessionId: bigint | null;
  orderId: bigint | null;
}

export type BusinessDateResolver = (at: Date) => string;

export function defaultBusinessDateResolver(at: Date): string {
  return new Date(at.getTime() + SETTLEMENT_VIETNAM_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function asBigInt(value: bigint | number | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function sessionDiscountValue(session: SettlementSessionRow): bigint {
  return session.discountAmountVnd == null ? 0n : asBigInt(session.discountAmountVnd);
}

function sessionRoundingValue(session: SettlementSessionRow): bigint {
  return session.roundingAmountVnd == null ? 0n : asBigInt(session.roundingAmountVnd);
}

function orderDiscountValue(order: SettlementOrderRow): bigint {
  return order.discountAmountVnd == null ? 0n : asBigInt(order.discountAmountVnd);
}

function orderRoundingValue(order: SettlementOrderRow): bigint {
  return order.roundingAmountVnd == null ? 0n : asBigInt(order.roundingAmountVnd);
}

function settlementTableName(order: SettlementOrderRow): string | null {
  return (
    order.table?.tableName ??
    order.table?.tableNo ??
    order.tableNoSnapshot ??
    null
  );
}

function serializeItems(orders: SettlementOrderRow[]): {
  items: MerchantSettlementItem[];
  itemQuantity: number;
} {
  const items: MerchantSettlementItem[] = [];
  let itemQuantity = 0;
  for (const order of orders) {
    for (const item of order.items ?? []) {
      items.push({
        id: item.id == null ? '' : item.id.toString(),
        productId: item.productId?.toString() ?? null,
        productNameZh: item.productNameZhSnapshot,
        productNameVi: item.product?.nameVi ?? null,
        productNameEn: item.product?.nameEn ?? null,
        imageUrl: item.imageUrlSnapshot,
        unitPriceVnd:
          item.unitPriceVnd == null ? '0' : asBigInt(item.unitPriceVnd).toString(),
        quantity: item.quantity,
        subtotalVnd: asBigInt(item.subtotalVnd).toString(),
        remark: item.remark,
      });
      itemQuantity += item.quantity;
    }
  }
  return { items, itemQuantity };
}

function serializeSourceOrders(orders: SettlementOrderRow[]): MerchantSettlementSourceOrder[] {
  return orders.map((order) => ({
    id: order.id.toString(),
    orderNo: order.orderNo,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    completedAt: iso(order.completedAt),
    cancelledAt: iso(order.cancelledAt),
    totalAmountVnd: asBigInt(order.totalAmountVnd).toString(),
    paymentMethod: order.paymentMethod ?? null,
  }));
}

function latestDate(...values: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (value && (!latest || value.getTime() > latest.getTime())) latest = value;
  }
  return latest;
}

function sessionSettledAt(
  session: SettlementSessionRow | null,
  completedOrders: SettlementOrderRow[],
): Date {
  const candidate = latestDate(
    session?.closedAt,
    ...completedOrders.map((order) => order.completedAt),
    ...completedOrders.map((order) => order.updatedAt),
  );
  if (candidate) return candidate;
  return completedOrders[0]?.createdAt ?? new Date(0);
}

function resolveSettlementBusinessDate(
  value: Date | null | undefined,
  fallback: Date,
  resolver: BusinessDateResolver,
): string {
  return dateOnly(value) ?? resolver(fallback);
}

function checkoutEvidenceSignature(log: SettlementCheckoutLogRow): string {
  return [
    log.originalAmountVnd ?? '',
    log.discountAmountVnd ?? '',
    log.roundingAmountVnd ?? '',
    log.finalPayableAmountVnd ?? '',
    log.payableAmountVnd ?? '',
    log.paymentMethod ?? '',
  ].join('|');
}

function detectCheckoutViolations(
  orders: SettlementOrderRow[],
  session: SettlementSessionRow | null,
  originalAmountVnd: bigint,
  discountAmountVnd: bigint,
  roundingAmountVnd: bigint,
): string[] {
  const violations: string[] = [];
  const logs = orders.flatMap((order) => order.checkoutLogs ?? []);
  if (!logs.length) return violations;

  const signatures = new Set(logs.map(checkoutEvidenceSignature));
  if (signatures.size > 1) {
    violations.push(
      `TABLE_SESSION_CHECKOUT_EVIDENCE_CONFLICT:${signatures.size}`,
    );
  }

  for (const log of logs) {
    const logOriginal = log.originalAmountVnd;
    const logDiscount = log.discountAmountVnd;
    const logRounding = log.roundingAmountVnd;
    const logPayable = log.finalPayableAmountVnd ?? log.payableAmountVnd;
    if (
      (logOriginal != null && asBigInt(logOriginal) !== originalAmountVnd) ||
      (logDiscount != null && asBigInt(logDiscount) !== discountAmountVnd) ||
      (logRounding != null && asBigInt(logRounding) !== roundingAmountVnd) ||
      (logPayable != null &&
        asBigInt(logPayable) !== originalAmountVnd - discountAmountVnd - roundingAmountVnd)
    ) {
      violations.push('SESSION_CHECKOUT_LOG_MISMATCH');
      break;
    }
  }

  return violations;
}

function buildTableSessionSettlement(
  sessionId: bigint,
  orders: SettlementOrderRow[],
  resolver: BusinessDateResolver,
): MerchantSettlement | null {
  const session = orders[0]?.tableSession ?? null;
  if (!session) return null;
  const completedOrders = orders.filter((order) => order.status === 'COMPLETED');
  if (!completedOrders.length) return null;

  const originalAmountVnd = completedOrders.reduce(
    (sum, order) => sum + asBigInt(order.totalAmountVnd),
    0n,
  );
  const discountAmountVnd = sessionDiscountValue(session);
  const roundingAmountVnd = sessionRoundingValue(session);
  const finalReceivableVnd =
    originalAmountVnd - discountAmountVnd - roundingAmountVnd;
  const settledAt = sessionSettledAt(session, completedOrders);
  const representative = completedOrders[0]!;
  const { items, itemQuantity } = serializeItems(completedOrders);
  const firstOrder = orders[0]!;

  return {
    settlementId: `session:${sessionId}`,
    kind: 'TABLE_SESSION',
    orderType: 'DINE_IN',
    status: 'COMPLETED',
    businessDate: resolveSettlementBusinessDate(
      session.businessDate,
      settledAt,
      resolver,
    ),
    settledAt: settledAt.toISOString(),
    tableSessionId: sessionId.toString(),
    tableId: representative.tableId?.toString() ?? firstOrder.table?.id?.toString() ?? null,
    tableName: settlementTableName(representative),
    orderIds: completedOrders.map((order) => order.id.toString()),
    orderNos: completedOrders.map((order) => order.orderNo),
    orderCount: completedOrders.length,
    itemQuantity,
    items,
    originalAmountVnd: originalAmountVnd.toString(),
    discountAmountVnd: discountAmountVnd.toString(),
    roundingAmountVnd: roundingAmountVnd.toString(),
    finalReceivableVnd: finalReceivableVnd.toString(),
    paymentMethod: session.paymentMethod ?? null,
    sourceOrders: serializeSourceOrders(orders),
    invariantViolations: detectCheckoutViolations(
      orders,
      session,
      originalAmountVnd,
      discountAmountVnd,
      roundingAmountVnd,
    ),
  };
}

function buildOrderSettlement(
  order: SettlementOrderRow,
  resolver: BusinessDateResolver,
): MerchantSettlement {
  const originalAmountVnd = asBigInt(order.totalAmountVnd);
  const discountAmountVnd = orderDiscountValue(order);
  const roundingAmountVnd = orderRoundingValue(order);
  const finalReceivableVnd =
    originalAmountVnd - discountAmountVnd - roundingAmountVnd;
  const settledAt =
    order.completedAt ?? order.cancelledAt ?? order.updatedAt ?? order.createdAt;
  const { items, itemQuantity } = serializeItems([order]);

  return {
    settlementId: `order:${order.id}`,
    kind: 'ORDER',
    orderType: order.orderType,
    status: order.status,
    businessDate: resolveSettlementBusinessDate(
      order.businessDate,
      settledAt,
      resolver,
    ),
    settledAt: settledAt.toISOString(),
    tableSessionId: order.tableSessionId?.toString() ?? null,
    tableId: order.tableId?.toString() ?? order.table?.id?.toString() ?? null,
    tableName: settlementTableName(order),
    orderIds: [order.id.toString()],
    orderNos: [order.orderNo],
    orderCount: 1,
    itemQuantity,
    items,
    originalAmountVnd: originalAmountVnd.toString(),
    discountAmountVnd: discountAmountVnd.toString(),
    roundingAmountVnd: roundingAmountVnd.toString(),
    finalReceivableVnd: finalReceivableVnd.toString(),
    paymentMethod: order.paymentMethod ?? null,
    sourceOrders: serializeSourceOrders([order]),
    invariantViolations: [],
  };
}

/**
 * Builds the canonical merchant settlement view from raw COMPLETED/CANCELLED
 * order rows. Aggregation happens here, before any pagination or search, so a
 * raw pagination boundary can never split one table-session settlement.
 */
export function buildMerchantSettlements(
  orders: SettlementOrderRow[],
  resolver: BusinessDateResolver = defaultBusinessDateResolver,
): MerchantSettlement[] {
  const sessions = new Map<bigint, SettlementOrderRow[]>();
  for (const order of orders) {
    if (
      order.status !== 'COMPLETED' &&
      order.status !== 'CANCELLED'
    ) {
      continue;
    }
    if (
      order.orderType === 'DINE_IN' &&
      order.tableSessionId != null &&
      order.tableSession?.status === 'CLOSED'
    ) {
      const group = sessions.get(order.tableSessionId) ?? [];
      group.push(order);
      sessions.set(order.tableSessionId, group);
    }
  }

  const settlements: MerchantSettlement[] = [];
  for (const [sessionId, group] of sessions) {
    const settlement = buildTableSessionSettlement(sessionId, group, resolver);
    if (settlement) settlements.push(settlement);
  }

  const sessionKeys = new Set(sessions.keys());
  for (const order of orders) {
    if (order.status !== 'COMPLETED' && order.status !== 'CANCELLED') continue;
    const inClosedSession =
      order.orderType === 'DINE_IN' &&
      order.tableSessionId != null &&
      sessionKeys.has(order.tableSessionId);
    if (inClosedSession) continue;
    settlements.push(buildOrderSettlement(order, resolver));
  }
  return settlements;
}

/** Financial facts consumed by analytics: one COMPLETED settlement = one fact. */
export function toSettlementFacts(
  settlements: MerchantSettlement[],
): MerchantSettlementFact[] {
  const facts: MerchantSettlementFact[] = [];
  for (const settlement of settlements) {
    if (settlement.status !== 'COMPLETED') continue;
    const tableSessionId =
      settlement.tableSessionId != null
        ? BigInt(settlement.tableSessionId)
        : null;
    const orderId =
      settlement.kind === 'ORDER' && settlement.orderIds[0] != null
        ? BigInt(settlement.orderIds[0])
        : null;
    facts.push({
      settlementId: settlement.settlementId,
      kind: settlement.kind,
      orderType: settlement.orderType,
      businessDate: settlement.businessDate,
      settledAt: new Date(settlement.settledAt),
      originalAmountVnd: BigInt(settlement.originalAmountVnd),
      discountAmountVnd: BigInt(settlement.discountAmountVnd),
      roundingAmountVnd: BigInt(settlement.roundingAmountVnd),
      finalRevenueVnd: BigInt(settlement.finalReceivableVnd),
      paymentMethod: settlement.paymentMethod,
      orderCount: settlement.orderCount,
      tableSessionId,
      orderId,
    });
  }
  return facts;
}

export function compareSettlementsBySettledAtDesc(
  left: MerchantSettlement,
  right: MerchantSettlement,
): number {
  const timeDiff = new Date(right.settledAt).getTime() - new Date(left.settledAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return right.settlementId.localeCompare(left.settlementId);
}

/** Unique completed settlement count for one business date (KPI reuse). */
export function countSettlementsForBusinessDate(
  orders: SettlementOrderRow[],
  businessDate: string,
  resolver: BusinessDateResolver = defaultBusinessDateResolver,
): number {
  return buildMerchantSettlements(orders, resolver).filter(
    (settlement) => settlement.businessDate === businessDate,
  ).length;
}
