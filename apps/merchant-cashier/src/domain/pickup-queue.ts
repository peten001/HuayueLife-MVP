import type { MerchantOrder } from '@/types';

export const PICKUP_FILTERS = [
  { value: 'ALL', key: 'fulfillment.pickupAll' },
  { value: 'PENDING_ACCEPTANCE', key: 'fulfillment.pickupPending' },
  { value: 'ACCEPTED', key: 'fulfillment.pickupConfirmed' },
  { value: 'PREPARING', key: 'fulfillment.pickupPreparing' },
  { value: 'READY', key: 'fulfillment.pickupReadyShort' },
  { value: 'DUE', key: 'fulfillment.pickupDue' },
] as const;
export type PickupFilter = (typeof PICKUP_FILTERS)[number]['value'];

export function pickupPreparationDue(scheduledFor: string | null | undefined, now: number) {
  return !scheduledFor || Date.parse(scheduledFor) - 30 * 60_000 <= now;
}

export function matchesPickupFilter(
  order: Pick<MerchantOrder, 'orderType' | 'status' | 'isReservation' | 'scheduledFor'>,
  filter: PickupFilter,
  now: number,
) {
  if (order.orderType !== 'PICKUP') return false;
  if (filter === 'ALL') return true;
  if (filter === 'ACCEPTED') return order.isReservation === true && order.status === 'ACCEPTED';
  if (filter === 'DUE') return order.isReservation === true && order.status === 'ACCEPTED'
    && pickupPreparationDue(order.scheduledFor, now);
  if (filter === 'PREPARING') return order.status === 'PREPARING'
    || (order.status === 'ACCEPTED' && !order.isReservation);
  return order.status === filter;
}
