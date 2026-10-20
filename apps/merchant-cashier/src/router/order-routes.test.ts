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

  it('inherits the current shell for all existing and future cashier workspaces without opt-in flags', () => {
    for (const name of ['tables', 'reservations', 'pickup-orders', 'delivery-orders', 'order-history']) {
      expect(router.resolve({ name }).meta.cashierWorkspace).toBe(true);
    }
    const remove = router.addRoute('cashier-workspace', {
      path: 'future-workspace', name: 'future-workspace', component: { template: '<div />' },
    });
    try {
      expect(router.resolve('/future-workspace').meta.cashierWorkspace).toBe(true);
    } finally { remove(); }
    expect(router.resolve({ name: 'login' }).meta.cashierWorkspace).not.toBe(true);
  });

  it('keeps every authenticated business route inside the current workspace', () => {
    const standalone = new Set(['login', 'change-password', 'kds', 'legacy-new-orders', 'legacy-active-orders']);
    for (const record of router.getRoutes()) {
      if (!record.name || standalone.has(String(record.name))) continue;
      const route = router.resolve({ name: record.name });
      if (route.meta.requiresAuth) expect(route.meta.cashierWorkspace, route.path).toBe(true);
    }
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

  it('resolves old bookmarks before mounting any cashier page or shell', () => {
    expect(router.resolve('/orders/new?order=new-1').name).toBe('legacy-new-orders');
    expect(router.resolve('/orders/active?order=delivery-1').name).toBe('legacy-active-orders');
    for (const path of ['/orders/new', '/orders/active']) {
      const route = router.resolve(path);
      expect(route.meta.requiresAuth).toBe(true);
      expect(route.matched).toHaveLength(1);
      expect(route.matched[0].components?.default).toBeFalsy();
    }
  });
});
