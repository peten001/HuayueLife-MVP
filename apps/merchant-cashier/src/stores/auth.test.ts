import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CASHIER_UNAUTHORIZED_EVENT, cashierStorageKeys } from '@/config';

const apiMocks = vi.hoisted(() => ({
  loginMerchant: vi.fn(),
  getMerchantMe: vi.fn(),
  getMerchantProfile: vi.fn(),
}));

vi.mock('@/api', () => ({
  changeMerchantPassword: vi.fn(),
  getMerchantMe: apiMocks.getMerchantMe,
  getMerchantProfile: apiMocks.getMerchantProfile,
  loginMerchant: apiMocks.loginMerchant,
  messageFromApiError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { useAuthStore } from './auth';

const loginResponse = {
  accessToken: 'test-session-token',
  staff: {
    id: 'staff-1',
    displayName: 'Test Staff',
    username: 'staff',
    role: 'MANAGER' as const,
    mustChangePassword: false,
    merchant: { id: 'merchant-1', nameZh: 'Test Merchant', status: 'ACTIVE' },
  },
};

const meResponse = {
  user: {
    sub: 'staff-1',
    accountType: 'MERCHANT_STAFF' as const,
    merchantId: 'merchant-1',
    role: 'MANAGER' as const,
    username: 'staff',
    mustChangePassword: false,
    merchant: { id: 'merchant-1', nameZh: 'Test Merchant', status: 'ACTIVE' },
  },
};

describe('cashier authentication storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setActivePinia(createPinia());
    apiMocks.loginMerchant.mockReset().mockResolvedValue(loginResponse);
    apiMocks.getMerchantMe.mockReset().mockResolvedValue(meResponse);
    apiMocks.getMerchantProfile.mockReset().mockResolvedValue({
      id: 'merchant-1',
      nameZh: 'Test Merchant',
      businessHours: {},
    });
  });

  it('persists the session only when keep-login is selected', async () => {
    const store = useAuthStore();
    await store.login('staff', 'password', true);

    expect(window.localStorage.getItem(cashierStorageKeys.accessToken)).toBe('test-session-token');
    expect(window.sessionStorage.getItem(cashierStorageKeys.accessToken)).toBeNull();
  });

  it('uses sessionStorage when keep-login is not selected', async () => {
    const store = useAuthStore();
    await store.login('staff', 'password', false);

    expect(window.localStorage.getItem(cashierStorageKeys.accessToken)).toBeNull();
    expect(window.sessionStorage.getItem(cashierStorageKeys.accessToken)).toBe('test-session-token');
  });

  it('restores a valid token even when the cached staff session is missing', async () => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'restored-token');
    setActivePinia(createPinia());

    const store = useAuthStore();
    await store.hydrate();

    expect(apiMocks.getMerchantMe).toHaveBeenCalledOnce();
    expect(store.isAuthenticated).toBe(true);
    expect(store.session?.username).toBe('staff');
    expect(store.profile?.id).toBe('merchant-1');
  });

  it('keeps the staff display name because the /merchant/me response has no displayName', async () => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'restored-token');
    window.localStorage.setItem(
      cashierStorageKeys.staffSession,
      JSON.stringify({ ...loginResponse.staff, displayName: 'Cashier Linh' }),
    );
    setActivePinia(createPinia());

    const store = useAuthStore();
    await store.hydrate();

    expect(store.session?.displayName).toBe('Cashier Linh');
  });

  it('clears both token stores when an authenticated API request reports 401', async () => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'expired-token');
    window.localStorage.setItem(cashierStorageKeys.staffSession, JSON.stringify(loginResponse.staff));
    setActivePinia(createPinia());
    const store = useAuthStore();
    await store.hydrate();

    window.dispatchEvent(new CustomEvent(CASHIER_UNAUTHORIZED_EVENT));

    expect(store.isAuthenticated).toBe(false);
    expect(store.authExpiredAt).not.toBeNull();
    expect(window.localStorage.getItem(cashierStorageKeys.accessToken)).toBeNull();
    expect(window.sessionStorage.getItem(cashierStorageKeys.accessToken)).toBeNull();
  });
});
