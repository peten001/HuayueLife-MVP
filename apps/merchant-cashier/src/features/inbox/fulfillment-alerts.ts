import type { MerchantOrder } from '@/types';

export function pendingFulfillmentAlerts(orders: MerchantOrder[]) {
  return orders.filter((order) => order.status === 'PENDING_ACCEPTANCE'
    && (order.orderType === 'PICKUP' || order.orderType === 'DELIVERY'));
}

export function unseenFulfillmentOrderIds(orders: MerchantOrder[], shown: ReadonlySet<string>) {
  return pendingFulfillmentAlerts(orders)
    .filter((order) => !shown.has(order.id))
    .map((order) => order.id);
}
