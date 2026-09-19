import { describe, expect, it } from 'vitest';
import type { MerchantOrder } from '@/types';
import { pendingFulfillmentAlerts, unseenFulfillmentOrderIds } from './fulfillment-alerts';

function order(id: string, orderType: MerchantOrder['orderType'], status: MerchantOrder['status']) {
  return { id, orderType, status } as MerchantOrder;
}

describe('cashier fulfillment alerts', () => {
  it('alerts only pending pickup and merchant delivery orders', () => {
    const orders = [
      order('table', 'DINE_IN', 'PENDING_ACCEPTANCE'),
      order('pickup', 'PICKUP', 'PENDING_ACCEPTANCE'),
      order('delivery', 'DELIVERY', 'PENDING_ACCEPTANCE'),
      order('accepted', 'DELIVERY', 'ACCEPTED'),
    ];
    expect(pendingFulfillmentAlerts(orders).map(({ id }) => id)).toEqual(['pickup', 'delivery']);
    expect(unseenFulfillmentOrderIds(orders, new Set(['pickup']))).toEqual(['delivery']);
  });
});
