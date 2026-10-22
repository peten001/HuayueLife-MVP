import type { MerchantOrder } from '@/types';

export const PICKUP_FILTERS = [
  { value: 'ALL', key: 'fulfillment.pickupAll' },
  { value: 'PENDING_ACCEPTANCE', key: 'fulfillment.pickupPending' },
  { value: 'PREPARING', key: 'fulfillment.pickupPreparing' },
  { value: 'READY', key: 'fulfillment.pickupReadyShort' },
] as const;
export type PickupFilter = (typeof PICKUP_FILTERS)[number]['value'];

export function matchesPickupFilter(
  order: Pick<MerchantOrder, 'orderType' | 'status' | 'isReservation' | 'scheduledFor'>,
  filter: PickupFilter,
) {
  if (order.orderType !== 'PICKUP') return false;
  if (filter === 'ALL') return true;
  if (filter === 'PREPARING') return order.status === 'PREPARING'
    || order.status === 'ACCEPTED';
  return order.status === filter;
}
