import { describe, expect, it, vi } from 'vitest';

import type { MerchantOrder } from '@/types';
import {
  normalizeRouteId,
  resolveLegacyOrderLocation,
  resolveOrderLocation,
  selectLegacyOrder,
} from './order-location';

function order(overrides: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: 'order-1',
    orderNo: '202607240001',
    merchantId: 'merchant-1',
    orderType: 'PICKUP',
    status: 'PENDING_ACCEPTANCE',
    itemAmountVnd: '100000',
    deliveryFeeVnd: '0',
    totalAmountVnd: '100000',
    settlementStatus: 'UNSETTLED',
    createdAt: '2026-07-24T01:00:00.000Z',
    updatedAt: '2026-07-24T01:00:00.000Z',
    items: [],
    ...overrides,
  };
}

describe('resolveOrderLocation', () => {
  it('routes final orders to history before considering fulfilment type', () => {
    expect(resolveOrderLocation(order({
      orderType: 'DELIVERY',
      status: 'COMPLETED',
    }))).toEqual({
      name: 'order-history',
      params: { orderId: 'order-1' },
    });

    expect(resolveOrderLocation(order({
      orderType: 'DINE_IN',
      status: 'CANCELLED',
      tableId: 'table-1',
    }))).toEqual({
      name: 'order-history',
      params: { orderId: 'order-1' },
    });
  });

  it('routes dine-in orders to their table and preserves the focused order', () => {
    expect(resolveOrderLocation(order({
      orderType: 'DINE_IN',
      tableId: 'table-7',
    }))).toEqual({
      name: 'tables',
      params: { tableId: 'table-7' },
      query: { order: 'order-1' },
    });
  });

  it('uses the related table ID when the snapshot tableId is absent', () => {
    expect(resolveOrderLocation(order({
      orderType: 'DINE_IN',
      tableId: null,
      table: { id: 'table-related', tableNo: 'A08' },
    }))).toEqual({
      name: 'tables',
      params: { tableId: 'table-related' },
      query: { order: 'order-1' },
    });
  });

  it('routes pickup and delivery to separate order workspaces', () => {
    expect(resolveOrderLocation(order({ orderType: 'PICKUP' }))).toEqual({
      name: 'pickup-orders',
      params: { orderId: 'order-1' },
    });
    expect(resolveOrderLocation(order({ orderType: 'DELIVERY' }))).toEqual({
      name: 'delivery-orders',
      params: { orderId: 'order-1' },
    });
  });
});

describe('legacy order location', () => {
  it('loads an explicit order and routes from its real type', async () => {
    const loadOrder = vi.fn().mockResolvedValue(order({
      id: 'delivery-9',
      orderType: 'DELIVERY',
      status: 'DELIVERING',
    }));
    const loadCollection = vi.fn();

    await expect(resolveLegacyOrderLocation({
      collection: 'active',
      orderId: 'delivery-9',
      loadOrder,
      loadCollection,
    })).resolves.toEqual({
      name: 'delivery-orders',
      params: { orderId: 'delivery-9' },
    });
    expect(loadOrder).toHaveBeenCalledWith('delivery-9');
    expect(loadCollection).not.toHaveBeenCalled();
  });

  it('selects from the corresponding live collection when no ID is explicit', async () => {
    const delivery = order({
      id: 'delivery-active',
      orderType: 'DELIVERY',
      status: 'READY',
    });

    await expect(resolveLegacyOrderLocation({
      collection: 'active',
      loadOrder: vi.fn(),
      loadCollection: vi.fn().mockResolvedValue([
        order({ id: 'stale-final', status: 'COMPLETED' }),
        delivery,
      ]),
    })).resolves.toEqual({
      name: 'delivery-orders',
      params: { orderId: 'delivery-active' },
    });
  });

  it('never treats a delivery order as pickup on the legacy active route', () => {
    const selected = selectLegacyOrder('active', [
      order({ id: 'delivery-2', orderType: 'DELIVERY', status: 'DELIVERING' }),
      order({ id: 'pickup-2', orderType: 'PICKUP', status: 'READY' }),
    ]);

    expect(selected?.id).toBe('delivery-2');
    expect(resolveOrderLocation(selected!)).toEqual({
      name: 'delivery-orders',
      params: { orderId: 'delivery-2' },
    });
  });

  it('falls back to the table overview only when no eligible order can be loaded', async () => {
    await expect(resolveLegacyOrderLocation({
      collection: 'pending',
      loadOrder: vi.fn(),
      loadCollection: vi.fn().mockResolvedValue([
        order({ status: 'ACCEPTED' }),
      ]),
    })).resolves.toEqual({ name: 'tables' });

    await expect(resolveLegacyOrderLocation({
      collection: 'active',
      orderId: 'removed-order',
      loadOrder: vi.fn().mockRejectedValue(new Error('not found')),
      loadCollection: vi.fn(),
    })).resolves.toEqual({ name: 'tables' });
  });

  it('normalizes route query values without accepting non-string IDs', () => {
    expect(normalizeRouteId([' order-1 ', 'order-2'])).toBe('order-1');
    expect(normalizeRouteId('  ')).toBe('');
    expect(normalizeRouteId(42)).toBe('');
  });
});
