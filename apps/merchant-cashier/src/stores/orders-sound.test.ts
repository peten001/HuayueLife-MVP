import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantOrder } from '@/types';
const api = vi.hoisted(() => ({ listMerchantOrders: vi.fn() }));
vi.mock('@/api', async original => ({ ...await original<typeof import('@/api')>(), ...api }));
vi.mock('./auth', () => ({ useAuthStore: () => ({ merchant: { id: 'm' } }) }));
import { useOrdersStore } from './orders';
import { useSoundStore } from './sound';
import { useLegacySoundStore } from './legacy-sound';
const order = (id: string, extra: Partial<MerchantOrder> = {}): MerchantOrder => ({
  id, orderNo: id, merchantId: 'm', orderType: 'DINE_IN', status: 'PENDING_ACCEPTANCE',
  itemAmountVnd: '50000', deliveryFeeVnd: '0', totalAmountVnd: '50000', settlementStatus: 'UNSETTLED',
  createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', items: [], ...extra,
});
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); api.listMerchantOrders.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe('cashier order receipt audio integration', () => {
  it('keeps mobile pending-only snapshots and the original partial-list baseline behavior', async () => {
    vi.stubGlobal('innerWidth', 390);
    const store = useOrdersStore(); const desktop = vi.spyOn(useSoundStore(), 'notifyNewOrders');
    const mobile = vi.spyOn(useLegacySoundStore(), 'notifyNewOrders');
    store.applyOrderSnapshot(order('pending'));
    expect(mobile).toHaveBeenCalledWith(['pending'], 'm');
    api.listMerchantOrders.mockResolvedValueOnce([order('pending'), order('qr', { userId: 'u', status: 'ACCEPTED' })]);
    await store.refreshLiveOrders();
    expect(mobile).toHaveBeenLastCalledWith(['pending'], 'm');
    expect(desktop).not.toHaveBeenCalled();
  });
  it('notices auto-accepted QR dine-in plus pending delivery/pickup orders, with table metadata', async () => {
    const store = useOrdersStore(); const sound = useSoundStore(); const observe = vi.spyOn(sound, 'notifyNewOrders');
    api.listMerchantOrders.mockResolvedValueOnce([]); await store.refreshLiveOrders();
    api.listMerchantOrders.mockResolvedValueOnce([
      order('qr', { userId: 'customer', status: 'ACCEPTED', tableNoSnapshot: '09' }),
      order('delivery', { orderType: 'DELIVERY' }), order('pickup', { orderType: 'PICKUP' }),
      order('staff', { createdByStaffId: 'staff', status: 'ACCEPTED' }),
    ]); await store.refreshLiveOrders();
    expect(sound.lastNotifiedOrderIds).toEqual(expect.arrayContaining(['qr', 'delivery', 'pickup']));
    expect(sound.lastNotifiedOrderIds).not.toContain('staff');
    expect(observe.mock.calls.at(-1)?.[0]).toContainEqual(expect.objectContaining({ id: 'qr', tableNo: '09', announce: true }));
  });
  it('does not replay on acceptance, edits, details, refresh or removal/reappearance', async () => {
    const store = useOrdersStore(); const sound = useSoundStore();
    api.listMerchantOrders.mockResolvedValueOnce([]); await store.refreshLiveOrders();
    api.listMerchantOrders.mockResolvedValueOnce([order('a')]); await store.refreshLiveOrders(); expect(sound.lastNotifiedOrderIds).toEqual(['a']);
    store.applyOrderSnapshot(order('a', { status: 'ACCEPTED' })); expect(sound.lastNotifiedOrderIds).toEqual([]);
    api.listMerchantOrders.mockResolvedValueOnce([]); await store.refreshLiveOrders();
    api.listMerchantOrders.mockResolvedValueOnce([order('a')]); await store.refreshLiveOrders(); expect(sound.lastNotifiedOrderIds).toEqual([]);
  });
  it('does not use a partial mutation or pending-only request as the initial full-list baseline', async () => {
    const store = useOrdersStore(); const sound = useSoundStore();
    store.applyOrderSnapshot(order('detail'));
    api.listMerchantOrders.mockResolvedValueOnce([order('pending')]); await store.fetchPending();
    api.listMerchantOrders.mockResolvedValueOnce([order('old-qr', { userId: 'customer', status: 'ACCEPTED' }), order('pending')]);
    await store.refreshLiveOrders(); expect(sound.lastNotifiedOrderIds).toEqual([]);
  });
  it('does not turn a failed initial refresh into an empty baseline', async () => {
    const store = useOrdersStore(); const sound = useSoundStore();
    api.listMerchantOrders.mockRejectedValueOnce(new Error('offline')); await store.refreshLiveOrders().catch(() => undefined);
    api.listMerchantOrders.mockResolvedValueOnce([order('old')]); await store.refreshLiveOrders(); expect(sound.lastNotifiedOrderIds).toEqual([]);
  });
});
