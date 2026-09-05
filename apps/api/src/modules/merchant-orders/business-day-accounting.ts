import { PaymentMethod, Prisma } from '@prisma/client';
import { isEffectiveOrder } from '../orders/effective-order';
import {
  addBusinessDays,
  assertBusinessDate,
  instantForBusinessDateMinute,
  resolveBusinessDate,
} from '../../common/utils/merchant-hours';

/**
 * Canonical Business Day order scope shared by every merchant-facing page.
 *
 * Dine-in belongs to the table's immutable OPENING business date, including
 * every later add-on and late checkout. Standalone pickup/delivery retain the
 * original-order business date. Never use the legacy session.businessDate:
 * that field records checkout date, not opening date.
 */

/** Candidate superset covers cross-midnight and rest-period orders. */
export function businessDateCandidateWhere(
  _scheduleValue: unknown,
  businessDate: string,
): Prisma.OrderWhereInput {
  return businessDateRangeCandidateWhere(businessDate, businessDate);
}

/**
 * Snapshot rows plus a bounded legacy OPENED-at/CREATED-at superset. Do not
 * bound dine-in by Order.createdAt/businessDate: late add-ons can be many days
 * after opening. Apply the exact resolver before grouping or summing.
 */
export function businessDateRangeCandidateWhere(
  startDate: string,
  endDate: string,
): Prisma.OrderWhereInput {
  assertBusinessDate(startDate);
  assertBusinessDate(endDate);
  const dateRange = {
    gte: new Date(`${startDate}T00:00:00.000Z`),
    lt: new Date(`${addBusinessDays(endDate, 1)}T00:00:00.000Z`),
  };
  const legacyRange = {
    gte: instantForBusinessDateMinute(addBusinessDays(startDate, -1), 0),
    lt: instantForBusinessDateMinute(addBusinessDays(endDate, 2), 6 * 60),
  };
  return { OR: [
    { orderType: 'DINE_IN', tableSession: { is: { OR: [
      { openedBusinessDate: dateRange },
      { openedBusinessDate: null, openedAt: legacyRange },
    ] } } },
    { AND: [
      { OR: [{ orderType: { not: 'DINE_IN' } }, { tableSessionId: null }] },
      { OR: [{ businessDate: dateRange }, { businessDate: null, createdAt: legacyRange }] },
    ] },
  ] };
}

export type OpeningBusinessDateSession = {
  openedBusinessDate?: Date | null;
  openedAt?: Date;
};

export type BusinessDateOrderLike = {
  orderType?: string;
  tableSession?: OpeningBusinessDateSession | null;
  businessDate?: Date | null;
  createdAt: Date;
};

export function resolveOrderBusinessDate(
  order: BusinessDateOrderLike,
  scheduleValue: unknown,
): string {
  return resolveOrderBusinessDateWithResolver(order, at => resolveBusinessDate(scheduleValue, at));
}

export function resolveOrderBusinessDateWithResolver(
  order: BusinessDateOrderLike,
  resolver: (at: Date) => string,
): string {
  if (order.orderType === 'DINE_IN' && order.tableSession) {
    if (order.tableSession.openedBusinessDate) return order.tableSession.openedBusinessDate.toISOString().slice(0, 10);
    if (order.tableSession.openedAt) return resolver(order.tableSession.openedAt);
  }
  return order.businessDate?.toISOString().slice(0, 10) ?? resolver(order.createdAt);
}

export function isOrderInBusinessDate(
  order: BusinessDateOrderLike,
  scheduleValue: unknown,
  businessDate: string,
): boolean {
  assertBusinessDate(businessDate);
  return resolveOrderBusinessDate(order, scheduleValue) === businessDate;
}

export function businessDateSnapshotValue(scheduleValue: unknown, at: Date): Date {
  return new Date(`${resolveBusinessDate(scheduleValue, at)}T00:00:00.000Z`);
}

export type SessionAttributionOrder = {
  voidedAt?: Date | null;
  id: bigint;
  totalAmountVnd: bigint;
  tableSessionId: bigint | null;
  discountPayableRateBps?: number | null;
  discountAmountVnd?: bigint | null;
  roundingAmountVnd?: bigint | null;
  paymentMethod?: PaymentMethod | null;
  tableSession?: {
    voidedAt?: Date | null;
    status?: string | null;
    discountAmountVnd?: bigint | null;
    roundingAmountVnd?: bigint | null;
    paymentMethod?: PaymentMethod | null;
  } | null;
};

export interface OrderRevenueAttribution {
  grossAmountVnd: bigint;
  discountAmountVnd: bigint;
  roundingAmountVnd: bigint;
  netSettledAmountVnd: bigint;
  paymentMethod: PaymentMethod | null;
}

export interface CompletedRevenueTotals {
  orderCount: number;
  grossAmountVnd: bigint;
  discountAmountVnd: bigint;
  roundingAmountVnd: bigint;
  netSettledAmountVnd: bigint;
  cashRevenueVnd: bigint;
  bankTransferRevenueVnd: bigint;
  unrecordedRevenueVnd: bigint;
}

/**
 * Distributes closed-table-session discount/rounding across the session's
 * billable orders proportionally to each order's share of the session gross.
 * Standalone orders keep their own order-level adjustments.
 *
 * Invariant: Σ per-order net over the session equals the session net, so
 * opening-business-date revenue sums correctly across all of a session's
 * orders, even when they were created or checked out on later days.
 */
export function attributeOrderRevenue(
  orders: SessionAttributionOrder[],
): Map<bigint, OrderRevenueAttribution> {
  orders = orders.filter(isEffectiveOrder);
  const attribution = new Map<bigint, OrderRevenueAttribution>();
  const sessions = new Map<string, SessionAttributionOrder[]>();
  for (const order of orders) {
    if (!order.tableSessionId || order.tableSession?.status !== 'CLOSED') continue;
    const key = order.tableSessionId.toString();
    const group = sessions.get(key) ?? [];
    group.push(order);
    sessions.set(key, group);
  }

  for (const [key, group] of sessions) {
    const session = group[0]!.tableSession!;
    const gross = group.reduce((sum, order) => sum + order.totalAmountVnd, 0n);
    const discount = session.discountAmountVnd ?? 0n;
    const rounding = session.roundingAmountVnd ?? 0n;
    const paymentMethod = session.paymentMethod ?? null;
    if (gross <= 0n) {
      for (const order of group) {
        attribution.set(order.id, {
          grossAmountVnd: order.totalAmountVnd,
          discountAmountVnd: 0n,
          roundingAmountVnd: 0n,
          netSettledAmountVnd: order.totalAmountVnd,
          paymentMethod,
        });
      }
      continue;
    }
    const discountShares = group.map((order) => (discount * order.totalAmountVnd) / gross);
    const roundingShares = group.map((order) => (rounding * order.totalAmountVnd) / gross);
    const discountRemainder = discount - discountShares.reduce((sum, value) => sum + value, 0n);
    const roundingRemainder = rounding - roundingShares.reduce((sum, value) => sum + value, 0n);
    group.forEach((order, index) => {
      const discountShare = discountShares[index]! + (index === group.length - 1 ? discountRemainder : 0n);
      const roundingShare = roundingShares[index]! + (index === group.length - 1 ? roundingRemainder : 0n);
      attribution.set(order.id, {
        grossAmountVnd: order.totalAmountVnd,
        discountAmountVnd: discountShare,
        roundingAmountVnd: roundingShare,
        netSettledAmountVnd: order.totalAmountVnd - discountShare - roundingShare,
        paymentMethod,
      });
    });
  }
  return attribution;
}

export function completedRevenueTotals(
  orders: SessionAttributionOrder[],
  attribution: Map<bigint, OrderRevenueAttribution> = attributeOrderRevenue(orders),
): CompletedRevenueTotals {
  orders = orders.filter(isEffectiveOrder);
  const totals: CompletedRevenueTotals = {
    orderCount: 0,
    grossAmountVnd: 0n,
    discountAmountVnd: 0n,
    roundingAmountVnd: 0n,
    netSettledAmountVnd: 0n,
    cashRevenueVnd: 0n,
    bankTransferRevenueVnd: 0n,
    unrecordedRevenueVnd: 0n,
  };
  for (const order of orders) {
    const orderAttribution = attribution.get(order.id) ?? {
      grossAmountVnd: order.totalAmountVnd,
      discountAmountVnd: order.discountAmountVnd ?? 0n,
      roundingAmountVnd: order.roundingAmountVnd ?? 0n,
      netSettledAmountVnd:
        order.totalAmountVnd -
        (order.discountAmountVnd ?? 0n) -
        (order.roundingAmountVnd ?? 0n),
      paymentMethod: order.paymentMethod ?? null,
    };
    totals.orderCount += 1;
    totals.grossAmountVnd += orderAttribution.grossAmountVnd;
    totals.discountAmountVnd += orderAttribution.discountAmountVnd;
    totals.roundingAmountVnd += orderAttribution.roundingAmountVnd;
    totals.netSettledAmountVnd += orderAttribution.netSettledAmountVnd;
    if (orderAttribution.paymentMethod === 'CASH') {
      totals.cashRevenueVnd += orderAttribution.netSettledAmountVnd;
    } else if (orderAttribution.paymentMethod === 'BANK_TRANSFER') {
      totals.bankTransferRevenueVnd += orderAttribution.netSettledAmountVnd;
    } else {
      totals.unrecordedRevenueVnd += orderAttribution.netSettledAmountVnd;
    }
  }
  return totals;
}
