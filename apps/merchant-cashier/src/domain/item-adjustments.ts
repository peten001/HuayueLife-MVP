import type { MerchantOrder } from '@/types';

const RETURNABLE_STATUSES = new Set(['ACCEPTED', 'PREPARING', 'READY']);

export interface PendingDecreaseMutation {
  orderId: string;
  itemId: string;
  requestKey: string;
  expectedQuantity: number;
  targetQuantity: number;
}

export interface PendingReturnMutation {
  orderId: string;
  itemId: string;
  requestKey: string;
  expectedQuantity: number;
  returnQuantity: number;
}

export type CommittedDecreaseExecutionPath = 'DECREASE' | 'RETURN';

export function canDecreaseOrderItems(
  order: Pick<MerchantOrder, 'orderType' | 'status' | 'tableSessionId'>,
) {
  return order.orderType === 'DINE_IN'
    && Boolean(order.tableSessionId)
    && order.status === 'PENDING_ACCEPTANCE';
}

export function canReturnOrderItems(
  order: Pick<MerchantOrder, 'orderType' | 'status' | 'tableSessionId'>,
) {
  return order.orderType === 'DINE_IN'
    && Boolean(order.tableSessionId)
    && RETURNABLE_STATUSES.has(order.status);
}

export function resolveCommittedDecreaseExecutionPath(
  order: Pick<MerchantOrder, 'orderType' | 'status' | 'tableSessionId'>,
  canonicalQuantity: number,
  itemQuantity: number,
): CommittedDecreaseExecutionPath | null {
  if (canonicalQuantity <= 0 || itemQuantity <= 0) return null;
  if (canReturnOrderItems(order)) return 'RETURN';
  if (canDecreaseOrderItems(order)) return 'DECREASE';
  return null;
}

export function hasItemAdjustmentInFlight(input: {
  adjustmentLoadingId: string;
  pendingDecrease: PendingDecreaseMutation | null;
  pendingReturn: PendingReturnMutation | null;
}) {
  return Boolean(input.adjustmentLoadingId || input.pendingDecrease || input.pendingReturn);
}

export function createMutationKey(prefix: 'add' | 'decrease' | 'return' | 'transfer' | 'canonical' | 'checkout' | 'release') {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function getOrCreatePendingDecreaseMutation(
  existing: PendingDecreaseMutation | null,
  input: { orderId: string; itemId: string; expectedQuantity: number },
  createKey: () => string = () => createMutationKey('decrease'),
): PendingDecreaseMutation | null {
  if (existing) {
    return existing.orderId === input.orderId && existing.itemId === input.itemId
      ? existing
      : null;
  }
  return {
    ...input,
    requestKey: createKey(),
    targetQuantity: input.expectedQuantity - 1,
  };
}

export function getOrCreatePendingReturnMutation(
  existing: PendingReturnMutation | null,
  input: Omit<PendingReturnMutation, 'requestKey'>,
  createKey: () => string = () => createMutationKey('return'),
): PendingReturnMutation | null {
  if (existing) {
    return existing.orderId === input.orderId && existing.itemId === input.itemId
      ? existing
      : null;
  }
  return { ...input, requestKey: createKey() };
}

export function hasUnresolvedCashierMutation(input: {
  orderingLocked: boolean;
  pendingDecrease: PendingDecreaseMutation | null;
  pendingReturn: PendingReturnMutation | null;
}) {
  return input.orderingLocked || Boolean(input.pendingDecrease) || Boolean(input.pendingReturn);
}

export function isPendingDecreaseInlineRetryReachable(input: {
  pending: PendingDecreaseMutation | null;
  selectedOrder: Pick<MerchantOrder, 'id' | 'items'> | null;
  detailOpen: boolean;
  showingTableDetail: boolean;
}) {
  const { pending, selectedOrder } = input;
  return Boolean(
    pending
    && input.detailOpen
    && !input.showingTableDetail
    && selectedOrder?.id === pending.orderId
    && selectedOrder.items.some((item) => item.id === pending.itemId),
  );
}

export function shouldBlockCashierMutationNavigation(input: {
  unresolvedMutation: boolean;
  authenticated: boolean;
  destinationName: string | symbol | null | undefined;
}) {
  if (!input.unresolvedMutation) return false;
  return !(input.authenticated === false && input.destinationName === 'login');
}

export function shouldExitMenuAfterItemMutation(input: {
  session: { status: 'OPEN' | 'CLOSED' };
  order?: { status: string } | null;
}) {
  return input.session.status === 'CLOSED';
}
