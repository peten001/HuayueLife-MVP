import { describe, expect, it } from 'vitest';

import router from './index';

describe('cashier order routes', () => {
  it('resolves canonical table, pickup, delivery, and history deep links', () => {
    expect(router.resolve({
      name: 'tables',
      params: { tableId: 'table-8' },
      query: { order: 'dine-3' },
    }).fullPath).toBe('/tables/table-8?order=dine-3');
    expect(router.resolve({
      name: 'pickup-orders',
      params: { orderId: 'pickup-3' },
    }).fullPath).toBe('/pickup/pickup-3');
    expect(router.resolve({
      name: 'delivery-orders',
      params: { orderId: 'delivery-3' },
    }).fullPath).toBe('/delivery/delivery-3');
    expect(router.resolve({
      name: 'order-history',
      params: { orderId: 'history-3' },
    }).fullPath).toBe('/orders/history/history-3');
  });

  it('retains collection pages when no entity is selected', () => {
    expect(router.resolve({ name: 'tables' }).fullPath).toBe('/tables');
    expect(router.resolve({ name: 'pickup-orders' }).fullPath).toBe('/pickup');
    expect(router.resolve({ name: 'delivery-orders' }).fullPath).toBe('/delivery');
    expect(router.resolve({ name: 'order-history' }).fullPath).toBe('/orders/history');
  });

  it('keeps development-only Mobile V2 routes isolated from canonical routes', () => {
    expect(router.resolve({
      name: 'mobile-v2-preview-tables',
      params: { tableId: 'table-8' },
      query: { view: 'menu' },
    }).fullPath).toBe('/__preview/mobile-v2/tables/table-8?view=menu');
    expect(router.resolve({
      name: 'mobile-v2-preview-pickup',
      params: { orderId: 'pickup-3' },
    }).fullPath).toBe('/__preview/mobile-v2/pickup/pickup-3');
    expect(router.resolve({ name: 'tables' }).fullPath).toBe('/tables');
    expect(router.resolve({ name: 'pickup-orders' }).fullPath).toBe('/pickup');
  });

  it('uses executable legacy routes instead of static redirects', () => {
    expect(router.resolve('/orders/new?order=new-1').name).toBe('legacy-new-orders');
    expect(router.resolve('/orders/active?order=delivery-1').name).toBe('legacy-active-orders');
  });
});
