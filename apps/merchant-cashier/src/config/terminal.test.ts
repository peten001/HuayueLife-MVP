import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('independent KDS terminal', () => {
  it('always sends a KDS login to the kitchen instead of a cashier redirect', async () => {
    vi.stubEnv('VITE_TERMINAL_MODE', 'kds'); vi.resetModules();
    const { loginDestination } = await import('./terminal');
    expect(loginDestination('/delivery/42')).toBe('/');
    expect(loginDestination(undefined)).toBe('/');
    const { cashierConfig, cashierStorageKeys } = await import('./index');
    expect(cashierConfig.brandName).toBe('YunQiao KDS');
    expect(cashierStorageKeys.accessToken).toBe('yunqiao_kds_access_token');
    expect(cashierStorageKeys.staffSession).toBe('yunqiao_kds_staff_session');
  });

  it('keeps the Cashier default, deep links and existing session keys', async () => {
    vi.stubEnv('VITE_TERMINAL_MODE', 'cashier'); vi.resetModules();
    const { loginDestination } = await import('./terminal');
    expect(loginDestination(undefined)).toBe('/tables');
    expect(loginDestination('/pickup/12')).toBe('/pickup/12');
    const { cashierConfig, cashierStorageKeys } = await import('./index');
    expect(cashierConfig.brandName).toBe('YunQiao Cashier');
    expect(cashierStorageKeys.accessToken).toBe('yunqiao_cashier_access_token');
  });

  it('does not expose cashier workspaces in the standalone KDS router', async () => {
    vi.stubEnv('VITE_TERMINAL_MODE', 'kds'); vi.resetModules();
    const { default: router } = await import('../router');
    expect(router.resolve('/').name).toBe('kds');
    expect(router.getRoutes().some(route => ['tables', 'pickup-orders', 'delivery-orders', 'order-history'].includes(String(route.name)))).toBe(false);
    expect(router.resolve('/tables').matched[0]?.redirect).toBe('/');
  });

  it('opens the production kitchen as a separate origin', async () => {
    vi.stubEnv('PROD', true); vi.stubEnv('VITE_KDS_URL', 'https://kds.huayueyouxuan.com/'); vi.resetModules();
    const { kdsEntryUrl, cashierEntryUrl } = await import('./terminal');
    expect(new URL(kdsEntryUrl).origin).toBe('https://kds.huayueyouxuan.com');
    expect(new URL(kdsEntryUrl).origin).not.toBe(new URL(cashierEntryUrl).origin);
  });
});
