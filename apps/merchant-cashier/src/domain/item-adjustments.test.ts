import { describe, expect, it } from 'vitest';
import {
  canDecreaseOrderItems,
  canReturnOrderItems,
  createMutationKey,
  getOrCreatePendingDecreaseMutation,
  getOrCreatePendingReturnMutation,
  hasUnresolvedCashierMutation,
  isPendingDecreaseInlineRetryReachable,
  shouldBlockCashierMutationNavigation,
} from './item-adjustments';

describe('cashier item-adjustment policy', () => {
  it('allows decrease only before acceptance on an open table-order context', () => {
    expect(canDecreaseOrderItems({
      orderType: 'DINE_IN',
      status: 'PENDING_ACCEPTANCE',
      tableSessionId: 'session-1',
    })).toBe(true);
    expect(canDecreaseOrderItems({
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
      tableSessionId: 'session-1',
    })).toBe(false);
    expect(canDecreaseOrderItems({
      orderType: 'PICKUP',
      status: 'PENDING_ACCEPTANCE',
      tableSessionId: null,
    })).toBe(false);
  });

  it.each(['ACCEPTED', 'PREPARING', 'READY'] as const)(
    'allows a simple item return in %s',
    (status) => {
      expect(canReturnOrderItems({
        orderType: 'DINE_IN',
        status,
        tableSessionId: 'session-1',
      })).toBe(true);
    },
  );

  it.each(['PENDING_ACCEPTANCE', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const)(
    'blocks item return in %s',
    (status) => {
      expect(canReturnOrderItems({
        orderType: 'DINE_IN',
        status,
        tableSessionId: 'session-1',
      })).toBe(false);
    },
  );

  it('creates distinct operation-scoped keys', () => {
    const first = createMutationKey('add');
    const second = createMutationKey('add');
    expect(first).toMatch(/^add-/);
    expect(second).toMatch(/^add-/);
    expect(second).not.toBe(first);
  });

  it('reuses the exact decrease payload and key until the same item outcome is resolved', () => {
    const initial = getOrCreatePendingDecreaseMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 3,
    }, () => 'decrease-stable');
    const retry = getOrCreatePendingDecreaseMutation(initial, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 99,
    });

    expect(retry).toBe(initial);
    expect(retry).toEqual({
      orderId: 'order-1', itemId: 'item-1', requestKey: 'decrease-stable',
      expectedQuantity: 3, targetQuantity: 2,
    });
    expect(getOrCreatePendingDecreaseMutation(initial, {
      orderId: 'order-1', itemId: 'item-2', expectedQuantity: 2,
    })).toBeNull();
  });

  it('retains a target-zero decrease request after the item row disappears', () => {
    const initial = getOrCreatePendingDecreaseMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 1,
    }, () => 'decrease-target-zero');
    const retry = getOrCreatePendingDecreaseMutation(initial, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 0,
    });

    expect(retry).toBe(initial);
    expect(retry).toEqual({
      orderId: 'order-1', itemId: 'item-1', requestKey: 'decrease-target-zero',
      expectedQuantity: 1, targetQuantity: 0,
    });
  });

  it('freezes the return quantity and key for a same-item retry', () => {
    const initial = getOrCreatePendingReturnMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 4, returnQuantity: 2,
    }, () => 'return-stable');
    const retry = getOrCreatePendingReturnMutation(initial, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 99, returnQuantity: 1,
    });

    expect(retry).toBe(initial);
    expect(retry).toMatchObject({ requestKey: 'return-stable', expectedQuantity: 4, returnQuantity: 2 });
    expect(getOrCreatePendingReturnMutation(initial, {
      orderId: 'order-1', itemId: 'item-2', expectedQuantity: 1, returnQuantity: 1,
    })).toBeNull();
  });

  it('blocks logout or route disposal while any mutation key is unresolved', () => {
    const decrease = getOrCreatePendingDecreaseMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 2,
    }, () => 'decrease-stable');
    const returned = getOrCreatePendingReturnMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 2, returnQuantity: 1,
    }, () => 'return-stable');

    expect(hasUnresolvedCashierMutation({
      orderingLocked: false, pendingDecrease: null, pendingReturn: null,
    })).toBe(false);
    expect(hasUnresolvedCashierMutation({
      orderingLocked: true, pendingDecrease: null, pendingReturn: null,
    })).toBe(true);
    expect(hasUnresolvedCashierMutation({
      orderingLocked: false, pendingDecrease: decrease, pendingReturn: null,
    })).toBe(true);
    expect(hasUnresolvedCashierMutation({
      orderingLocked: false, pendingDecrease: null, pendingReturn: returned,
    })).toBe(true);
  });

  it('uses the row retry only while that exact item row is visibly reachable', () => {
    const pending = getOrCreatePendingDecreaseMutation(null, {
      orderId: 'order-1', itemId: 'item-1', expectedQuantity: 1,
    }, () => 'decrease-target-zero');
    const selectedOrder = {
      id: 'order-1',
      items: [{
        id: 'item-1', productNameZhSnapshot: '牛肉粉', quantity: 1, subtotalVnd: '68000',
      }],
    };

    expect(isPendingDecreaseInlineRetryReachable({
      pending, selectedOrder, detailOpen: true, showingTableDetail: false,
    })).toBe(true);
    expect(isPendingDecreaseInlineRetryReachable({
      pending, selectedOrder: { ...selectedOrder, items: [] }, detailOpen: true,
      showingTableDetail: false,
    })).toBe(false);
    expect(isPendingDecreaseInlineRetryReachable({
      pending, selectedOrder, detailOpen: false, showingTableDetail: false,
    })).toBe(false);
    expect(isPendingDecreaseInlineRetryReachable({
      pending, selectedOrder, detailOpen: true, showingTableDetail: true,
    })).toBe(false);
  });

  it('blocks child and parent route disposal but permits forced auth-expiry login', () => {
    expect(shouldBlockCashierMutationNavigation({
      unresolvedMutation: true, authenticated: true, destinationName: 'tables',
    })).toBe(true);
    expect(shouldBlockCashierMutationNavigation({
      unresolvedMutation: true, authenticated: true, destinationName: 'login',
    })).toBe(true);
    expect(shouldBlockCashierMutationNavigation({
      unresolvedMutation: true, authenticated: false, destinationName: 'login',
    })).toBe(false);
    expect(shouldBlockCashierMutationNavigation({
      unresolvedMutation: false, authenticated: true, destinationName: 'tables',
    })).toBe(false);
  });
});
