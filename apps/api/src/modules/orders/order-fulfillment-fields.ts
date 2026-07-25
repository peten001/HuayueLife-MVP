import { OrderType } from '@prisma/client';

const PICKUP_ESTIMATE_MINUTES = 30;
const PICKUP_ESTIMATE_MS = PICKUP_ESTIMATE_MINUTES * 60_000;

type OrderFulfillmentSource = {
  orderType: OrderType;
  orderNo: string;
  createdAt: Date;
  readyAt: Date | null;
};

export type PickupFulfillmentFields = {
  pickupCode: string;
  estimatedReadyAt: Date;
};

/**
 * Derive pickup display fields from persisted order facts. Keeping this pure
 * gives customer and merchant projections one stable contract without adding
 * storage columns for values that can always be reconstructed.
 */
export function pickupFulfillmentFields(
  order: OrderFulfillmentSource,
): PickupFulfillmentFields | null {
  if (order.orderType !== 'PICKUP') return null;

  const normalizedOrderNo = order.orderNo.replace(/[^A-Za-z0-9]/g, '');
  return {
    pickupCode: normalizedOrderNo.slice(-4).toUpperCase(),
    estimatedReadyAt: order.readyAt
      ? new Date(order.readyAt.getTime())
      : new Date(order.createdAt.getTime() + PICKUP_ESTIMATE_MS),
  };
}

export function withPickupFulfillmentFields<T extends OrderFulfillmentSource>(
  order: T,
): T & Partial<PickupFulfillmentFields> {
  const fields = pickupFulfillmentFields(order);
  return fields ? { ...order, ...fields } : order;
}
