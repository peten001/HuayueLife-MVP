import { PaymentMethod, Prisma } from '@prisma/client';
import {
  addBusinessDays,
  assertBusinessDate,
  businessDayWindow,
  instantForBusinessDateMinute,
  normalizeBusinessHours,
  resolveBusinessDate,
} from '../../common/utils/merchant-hours';

/**
 * Canonical Business Day order scope shared by every merchant-facing page.
 *
 * BusinessDateOrderSet(D) =
 *   { Order.businessDate = D }                        (snapshot, written at creation)
 *   ∪ { businessDate IS NULL ∧ legacyResolver(createdAt) = D }
 *
 * The legacy resolver is resolveBusinessDate(schedule, createdAt): the order
 * belongs to the business date whose accounting window contains its creation
 * instant. This is the ONLY legacy resolver any service may use; services must
 * not re-implement natural-day, completedAt, or segment-sliced scopes.
 */

/** Candidate superset covers cross-midnight and rest-period orders. */
export function businessDateCandidateWhere(
  scheduleValue: unknown,
  businessDate: string,
): Prisma.OrderWhereInput {
  assertBusinessDate(businessDate);
  const schedule = normalizeBusinessHours(scheduleValue);
  const window = businessDayWindow(schedule, businessDate);
  const start = window?.start ?? instantForBusinessDateMinute(businessDate, 0);
  const end = window?.end ?? instantForBusinessDateMinute(addBusinessDays(businessDate, 1), 0);
  const broadStart = new Date(Math.min(
    start.getTime(),
    instantForBusinessDateMinute(addBusinessDays(businessDate, -1), 0).getTime(),
  ));
  const broadEnd = new Date(Math.max(
    end.getTime(),
    instantForBusinessDateMinute(addBusinessDays(businessDate, 2), 6 * 60).getTime(),
  ));
  return {
    OR: [
      { businessDate: new Date(`${businessDate}T00:00:00.000Z`) },
      { businessDate: null, createdAt: { gte: broadStart, lt: broadEnd } },
    ],
  };
}

/**
 * Superset where clause for a business-date range: snapshot rows plus legacy
 * rows created between (startDate - 1 day 00:00) and (endDate + 2 days 06:00)
 * in the business time zone. The exact per-order resolver must still be
 * applied in memory.
 */
export function businessDateRangeCandidateWhere(
  startDate: string,
  endDate: string,
): Prisma.OrderWhereInput {
  assertBusinessDate(startDate);
  assertBusinessDate(endDate);
  return {
    OR: [
      {
        businessDate: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lt: new Date(`${addBusinessDays(endDate, 1)}T00:00:00.000Z`),
        },
      },
      {
        businessDate: null,
        createdAt: {
          gte: instantForBusinessDateMinute(addBusinessDays(startDate, -1), 0),
          lt: instantForBusinessDateMinute(addBusinessDays(endDate, 2), 6 * 60),
        },
      },
    ],
  };
}

export type BusinessDateOrderLike = {
  businessDate?: Date | null;
  createdAt: Date;
};

export function isOrderInBusinessDate(
  order: BusinessDateOrderLike,
  scheduleValue: unknown,
  businessDate: string,
): boolean {
  assertBusinessDate(businessDate);
  if (order.businessDate) {
    return order.businessDate.toISOString().slice(0, 10) === businessDate;
  }
  return resolveBusinessDate(scheduleValue, order.createdAt) === businessDate;
}

export function businessDateSnapshotValue(scheduleValue: unknown, at: Date): Date {
  return new Date(`${resolveBusinessDate(scheduleValue, at)}T00:00:00.000Z`);
}

export type SessionAttributionOrder = {
  id: bigint;
  totalAmountVnd: bigint;
  tableSessionId: bigint | null;
  discountPayableRateBps?: number | null;
  discountAmountVnd?: bigint | null;
  roundingAmountVnd?: bigint | null;
  paymentMethod?: PaymentMethod | null;
  tableSession?: {
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
 * per-business-date revenue always sums correctly even when one session spans
 * two business dates.
 */
export function attributeOrderRevenue(
  orders: SessionAttributionOrder[],
): Map<bigint, OrderRevenueAttribution> {
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
