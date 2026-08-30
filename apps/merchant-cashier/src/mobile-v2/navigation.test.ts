import { describe, expect, it } from 'vitest';
import {
  canonicalCashierRouteName,
  mobileV2PreviewRouteNames,
  resolveCashierPresentationLocation,
} from './navigation';

describe('isolated Mobile V2 presentation navigation', () => {
  it('leaves production destinations unchanged outside preview', () => {
    const destination = { name: 'tables', params: { tableId: 'table-8' } } as const;
    expect(resolveCashierPresentationLocation(false, destination)).toBe(destination);
    expect(resolveCashierPresentationLocation(false, '/orders/history')).toBe('/orders/history');
  });

  it('maps canonical named destinations into the preview namespace', () => {
    expect(resolveCashierPresentationLocation(true, {
      name: 'tables',
      params: { tableId: 'table-8' },
      query: { view: 'menu' },
    })).toEqual({
      name: mobileV2PreviewRouteNames.tables,
      params: { tableId: 'table-8' },
      query: { view: 'menu' },
    });
    expect(resolveCashierPresentationLocation(true, {
      name: 'order-history',
      params: { orderId: 'settlement-3' },
    })).toEqual({
      name: mobileV2PreviewRouteNames.history,
      params: { orderId: 'settlement-3' },
    });
  });

  it('maps canonical collection paths without touching unrelated paths', () => {
    expect(resolveCashierPresentationLocation(true, '/pickup')).toBe('/__preview/mobile-v2/pickup');
    expect(resolveCashierPresentationLocation(true, '/login')).toBe('/login');
  });

  it('exposes canonical route identities to the existing capability and mutation guards', () => {
    expect(canonicalCashierRouteName(mobileV2PreviewRouteNames.tables)).toBe('tables');
    expect(canonicalCashierRouteName(mobileV2PreviewRouteNames.delivery)).toBe('delivery-orders');
    expect(canonicalCashierRouteName('login')).toBe('login');
  });
});
