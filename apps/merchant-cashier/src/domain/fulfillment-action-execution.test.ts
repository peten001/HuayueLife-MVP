import { describe, expect, it, vi } from 'vitest';

import type { MerchantOrder } from '@/types';
import { executeFulfillmentActionSequence } from './fulfillment-action-execution';

function order(overrides: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: 'order-18',
    orderNo: 'HY-18',
    merchantId: 'merchant-1',
    orderType: 'PICKUP',
    status: 'READY',
    itemAmountVnd: '50000',
    deliveryFeeVnd: '0',
    totalAmountVnd: '50000',
    settlementStatus: 'UNSETTLED',
    createdAt: '2026-08-30T01:00:00.000Z',
    updatedAt: '2026-08-30T01:00:00.000Z',
    items: [],
    ...overrides,
  };
}

describe('executeFulfillmentActionSequence', () => {
  it.each([
    ['PICKUP', 'CASH'],
    ['DELIVERY', 'BANK_TRANSFER'],
  ] as const)('completes %s once with %s and performs aftercare', async (orderType, paymentMethod) => {
    const current = order({ orderType });
    const completed = order({ orderType, status: 'COMPLETED' });
    const runAction = vi.fn().mockResolvedValue(completed);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);

    const result = await executeFulfillmentActionSequence({
      order: current,
      actions: ['complete'],
      paymentMethod,
      runAction,
      refresh,
      resolveLocation: (updated) => ({ name: 'order-history', params: { orderId: updated.id } }),
      navigate,
    });

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith(current.id, 'complete', paymentMethod);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ name: 'order-history', params: { orderId: current.id } });
    expect(result).toEqual({ order: completed, aftercareFailures: [] });
  });

  it('keeps a committed completion successful when refresh fails', async () => {
    const completed = order({ status: 'COMPLETED' });
    const navigate = vi.fn().mockResolvedValue(undefined);
    await expect(executeFulfillmentActionSequence({
      order: order(),
      actions: ['complete'],
      paymentMethod: 'CASH',
      runAction: vi.fn().mockResolvedValue(completed),
      refresh: vi.fn().mockRejectedValue(new Error('refresh unavailable')),
      resolveLocation: () => ({ name: 'order-history', params: { orderId: completed.id } }),
      navigate,
    })).resolves.toEqual({ order: completed, aftercareFailures: ['refresh'] });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not run refresh or navigation after a pre-transaction 5xx', async () => {
    const refresh = vi.fn();
    const navigate = vi.fn();
    await expect(executeFulfillmentActionSequence({
      order: order({ orderType: 'DELIVERY' }),
      actions: ['complete'],
      paymentMethod: 'BANK_TRANSFER',
      runAction: vi.fn().mockRejectedValue(new Error('HTTP 500 before commit')),
      refresh,
      resolveLocation: () => ({ name: 'order-history' }),
      navigate,
    })).rejects.toThrow('HTTP 500 before commit');
    expect(refresh).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
