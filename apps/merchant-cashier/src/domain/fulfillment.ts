import type {
  MerchantOrder,
  MerchantOrderAction,
  OrderStatus,
  OrderType,
} from '@/types';

export type FulfillmentWorkflowAction =
  | 'accept'
  | 'finish-preparing'
  | 'start-delivery'
  | 'complete';

export const ENDED_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export function isEndedOrder(order: Pick<MerchantOrder, 'status'>) {
  return ENDED_ORDER_STATUSES.includes(order.status);
}

export function pickupCode(order: Pick<MerchantOrder, 'pickupCode' | 'orderNo' | 'id'>) {
  const provided = order.pickupCode?.trim();
  return provided || '';
}

export function estimatedReadyAt(
  order: Pick<MerchantOrder, 'estimatedReadyAt' | 'readyAt' | 'acceptedAt' | 'createdAt'>,
) {
  if (order.estimatedReadyAt) return order.estimatedReadyAt;
  if (order.readyAt) return order.readyAt;
  return null;
}

export function maskedPhone(phone?: string | null) {
  if (!phone) return '';
  const compact = phone.replace(/\s/g, '');
  if (compact.length <= 5) return compact;
  const visibleStart = Math.min(3, compact.length - 4);
  return `${compact.slice(0, visibleStart)}${'*'.repeat(compact.length - visibleStart - 3)}${compact.slice(-3)}`;
}

export function waitingMinutes(createdAt: string, now = Date.now()) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((now - created) / 60_000));
}

export function packingFeeVnd(
  order: Pick<MerchantOrder, 'itemAmountVnd' | 'deliveryFeeVnd' | 'totalAmountVnd'>,
) {
  try {
    const residual = BigInt(order.totalAmountVnd)
      - BigInt(order.itemAmountVnd)
      - BigInt(order.deliveryFeeVnd);
    return (residual > 0n ? residual : 0n).toString();
  } catch {
    return '0';
  }
}

export function nextFulfillmentAction(order: Pick<MerchantOrder, 'orderType' | 'status'>) {
  if (order.status === 'PENDING_ACCEPTANCE') return 'accept' as const;
  if (order.status === 'ACCEPTED' || order.status === 'PREPARING') {
    return 'finish-preparing' as const;
  }
  if (order.status === 'READY') {
    return order.orderType === 'DELIVERY' ? 'start-delivery' as const : 'complete' as const;
  }
  if (order.status === 'DELIVERING' && order.orderType === 'DELIVERY') return 'complete' as const;
  return null;
}

/**
 * Translate the compact cashier workflow into the existing server state
 * machine. Accepting immediately enters preparation; an ACCEPTED snapshot is
 * retained only as a recoverable intermediate state after a partial request.
 */
export function fulfillmentActionSequence(
  order: Pick<MerchantOrder, 'orderType' | 'status'>,
  action: FulfillmentWorkflowAction,
): readonly MerchantOrderAction[] {
  if (action === 'accept' && order.status === 'PENDING_ACCEPTANCE') {
    return ['accept', 'start-preparing'];
  }
  if (action === 'finish-preparing' && order.status === 'ACCEPTED') {
    return ['start-preparing', 'ready'];
  }
  if (action === 'finish-preparing' && order.status === 'PREPARING') {
    return ['ready'];
  }
  if (action === 'start-delivery' && order.orderType === 'DELIVERY' && order.status === 'READY') {
    return ['start-delivery'];
  }
  if (
    action === 'complete'
    && (
      (order.orderType === 'PICKUP' && order.status === 'READY')
      || (order.orderType === 'DELIVERY' && order.status === 'DELIVERING')
    )
  ) {
    return ['complete'];
  }
  return [];
}

export function orderMatchesFulfillmentType(order: MerchantOrder, orderType: OrderType) {
  return order.orderType === orderType;
}
