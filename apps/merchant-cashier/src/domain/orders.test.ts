import { describe, expect, it } from 'vitest';
import type { MerchantOrderAction, OrderStatus, OrderType } from '@/types';
import { availableOrderActions, canRunOrderAction } from './orders';

const ALL_ACTIONS: readonly MerchantOrderAction[] = [
  'accept',
  'reject',
  'start-preparing',
  'ready',
  'start-delivery',
  'complete',
];

const ORDER_TYPES: readonly OrderType[] = ['DINE_IN', 'PICKUP', 'DELIVERY'];
const ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
];

function expectedActions(status: OrderStatus, orderType: OrderType): MerchantOrderAction[] {
  if (status === 'PENDING_ACCEPTANCE') return ['accept', 'reject'];
  if (status === 'ACCEPTED') return ['reject', 'start-preparing'];
  if (status === 'PREPARING') return ['ready'];
  if (status === 'READY') {
    return orderType === 'DELIVERY' ? ['start-delivery'] : ['complete'];
  }
  if (status === 'DELIVERING' && orderType === 'DELIVERY') return ['complete'];
  return [];
}

describe('merchant order action matrix', () => {
  it.each(
    ORDER_STATUSES.flatMap((status) =>
      ORDER_TYPES.map((orderType) => ({ status, orderType })),
    ),
  )('allows only server-supported actions for $status / $orderType', ({ status, orderType }) => {
    const order = { status, orderType };
    const expected = expectedActions(status, orderType);

    expect(availableOrderActions(order)).toEqual(expected);
    expect(ALL_ACTIONS.filter((action) => canRunOrderAction(order, action))).toEqual(expected);
  });

  it('does not expose terminal actions after completion or cancellation', () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      for (const orderType of ORDER_TYPES) {
        expect(availableOrderActions({ status, orderType })).toEqual([]);
      }
    }
  });
});
