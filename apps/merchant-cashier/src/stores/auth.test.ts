import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cashierStorageKeys } from '@/config';

const apiMocks = vi.hoisted(() => ({
  loginMerchant: vi.fn(),
  getMerchantProfile: vi.fn(),
}));

vi.mock('@/api', () => ({
  changeMerchantPassword: vi.fn(),
  getMerchantMe: vi.fn(),
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

describe('cashier authentication storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setActivePinia(createPinia());
    apiMocks.loginMerchant.mockReset().mockResolvedValue(loginResponse);
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
});
