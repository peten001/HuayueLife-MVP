import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth';
import { getMerchantOrder } from '@/api';
import type { MerchantOrder } from '@/types';
import router from './index';

vi.mock('@/api', async () => ({
  ...await vi.importActual<typeof import('@/api')>('@/api'),
  getMerchantOrder: vi.fn(),
}));

describe('old cashier bookmarks use canonical navigation before rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    useAuthStore().$patch({
      hydrated: true, demoMode: true,
      session: { id: 'staff', displayName: 'Staff', role: 'OWNER', mustChangePassword: false,
        merchant: { id: 'merchant', nameZh: 'Merchant', status: 'ACTIVE', merchantMode: 'MANAGED',
          capabilities: ['qrOrderEnabled', 'pickupEnabled', 'deliveryEnabled'].map(code => ({ code, isEnabled: true })) } },
    });
    vi.mocked(getMerchantOrder).mockReset();
  });

  it('does not commit the bookmark route while waiting for an order, and resolves changed IDs again', async () => {
    await router.push('/reservations');
    const visited: string[] = [];
    const stop = router.afterEach(to => { visited.push(to.path); });
    let finish!: (order: MerchantOrder) => void;
    vi.mocked(getMerchantOrder).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const navigation = router.push('/orders/new?order=pickup-1');
    await vi.waitFor(() => expect(getMerchantOrder).toHaveBeenCalledWith('pickup-1'));
    expect(router.currentRoute.value.path).toBe('/reservations');
    finish({ id: 'pickup-1', orderType: 'PICKUP', status: 'PENDING_ACCEPTANCE' } as MerchantOrder);
    await navigation;
    expect(router.currentRoute.value.path).toBe('/pickup/pickup-1');
    vi.mocked(getMerchantOrder).mockResolvedValueOnce({ id: 'delivery-2', orderType: 'DELIVERY', status: 'READY' } as MerchantOrder);
    await router.push('/orders/new?orderId=delivery-2');
    expect(router.currentRoute.value.path).toBe('/delivery/delivery-2');
    expect(visited).not.toContain('/orders/new');
    stop();
  });

  it('retains authentication and password-change gates ahead of bookmark resolution', async () => {
    const auth = useAuthStore();
    auth.$patch({ demoMode: false, session: null, accessToken: '' });
    await router.push('/orders/active?order=private-1');
    expect(router.currentRoute.value.name).toBe('login');
    expect(getMerchantOrder).not.toHaveBeenCalled();
    auth.$patch({ demoMode: true, session: { id: 'staff', displayName: 'Staff', role: 'OWNER',
      mustChangePassword: true, merchant: { id: 'merchant', nameZh: 'Merchant', status: 'ACTIVE' } } });
    await router.push('/orders/active?order=private-1');
    expect(router.currentRoute.value.name).toBe('change-password');
    expect(getMerchantOrder).not.toHaveBeenCalled();
  });
});
