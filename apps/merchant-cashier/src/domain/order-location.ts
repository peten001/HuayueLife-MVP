import type { RouteLocationRaw } from 'vue-router';

import type { MerchantOrder, OrderStatus } from '@/types';

export type LegacyOrderCollection = 'pending' | 'active';

export type LocatableOrder = Pick<
  MerchantOrder,
  'id' | 'orderType' | 'status' | 'tableId'
> & {
  table?: Pick<NonNullable<MerchantOrder['table']>, 'id'> | null;
};

export interface ResolveLegacyOrderLocationOptions {
  collection: LegacyOrderCollection;
  orderId?: string | null;
  loadOrder: (orderId: string) => Promise<MerchantOrder>;
  loadCollection: () => Promise<readonly MerchantOrder[]>;
  fallback?: RouteLocationRaw;
}

const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];
const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
];

/**
 * Return the one canonical cashier workspace for an order.
 *
 * Final status wins over fulfilment type so stale links never reopen a live
 * workflow after an order has completed or been cancelled.
 */
export function resolveOrderLocation(order: LocatableOrder): RouteLocationRaw {
  const orderId = normalizeRouteId(order.id);
  if (!orderId) return { name: 'tables' };

  if (FINAL_ORDER_STATUSES.includes(order.status)) {
    return {
      name: 'order-history',
      params: { orderId },
    };
  }

  if (order.orderType === 'DINE_IN') {
    const tableId = normalizeRouteId(order.tableId) || normalizeRouteId(order.table?.id);
    return {
      name: 'tables',
      ...(tableId ? { params: { tableId } } : {}),
      query: { order: orderId },
    };
  }

  if (order.orderType === 'PICKUP') {
    return {
      name: 'pickup-orders',
      params: { orderId },
    };
  }

  return {
    name: 'delivery-orders',
    params: { orderId },
  };
}

/**
 * Resolve legacy unified inbox routes without guessing a fulfilment type.
 * Explicit IDs are loaded from the order detail endpoint. Without an ID, the
 * corresponding live collection is refreshed and its first eligible order is
 * routed by the same canonical resolver.
 */
export async function resolveLegacyOrderLocation(
  options: ResolveLegacyOrderLocationOptions,
): Promise<RouteLocationRaw> {
  const fallback = options.fallback ?? { name: 'tables' };
  const orderId = normalizeRouteId(options.orderId);

  try {
    if (orderId) {
      return resolveOrderLocation(await options.loadOrder(orderId));
    }

    const orders = await options.loadCollection();
    const order = selectLegacyOrder(options.collection, orders);
    return order ? resolveOrderLocation(order) : fallback;
  } catch {
    // Compatibility navigation must remain recoverable when an old bookmark
    // references a removed order or the live collection cannot be refreshed.
    return fallback;
  }
}

export function selectLegacyOrder(
  collection: LegacyOrderCollection,
  orders: readonly MerchantOrder[],
) {
  return orders.find((order) => (
    collection === 'pending'
      ? order.status === 'PENDING_ACCEPTANCE'
      : ACTIVE_ORDER_STATUSES.includes(order.status)
  )) ?? null;
}

export function normalizeRouteId(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? candidate.trim() : '';
}
