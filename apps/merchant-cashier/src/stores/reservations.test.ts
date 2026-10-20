import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalReservation } from '@huayue-life/shared';
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), auth: { isAuthenticated: true, merchant: { id: '3' } }, toast: vi.fn(), sound: vi.fn() }));
vi.mock('@/api/reservations', () => ({ listReservations: mocks.list, updateReservation: mocks.update }));
vi.mock('./auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('./ui', () => ({ useUiStore: () => ({ pushToast: mocks.toast }) }));
vi.mock('./sound', () => ({ useSoundStore: () => ({ notifyNewOrders: mocks.sound }) }));
import { useReservationsStore } from './reservations';

const row = (patch: Partial<ArrivalReservation> = {}): ArrivalReservation => ({ id: '1', kind: 'DINE_IN', reservationNo: 'YY1', status: 'PENDING', scheduledFor: '2026-10-19T12:00:00Z', guestCount: 2,
  merchant: { id: '3', nameZh: '测试' }, createdAt: '2026-10-19T08:00:00Z', itemAmountVnd: '0', items: [], ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const response = (rows: ArrivalReservation[]) => ({ reservations: rows, serverTime: '2026-10-19T11:45:00Z' });

describe('reservation store', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); mocks.auth.isAuthenticated = true; mocks.auth.merchant = { id: '3' }; });
  it('deduplicates simultaneous polls and announces new dining requests once', async () => {
    const next = deferred<ReturnType<typeof response>>(); mocks.list.mockReturnValue(next.promise);
    const store = useReservationsStore(); const a = store.load(); const b = store.load();
    expect(mocks.list).toHaveBeenCalledTimes(1); next.resolve(response([row()])); await Promise.all([a, b]);
    expect(store.pending).toHaveLength(1); expect(mocks.toast).toHaveBeenCalledTimes(1);
    mocks.list.mockResolvedValue(response([row()])); await store.load(); expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it('uses server time for preparation reminders and includes ASAP only after confirmation', async () => {
    mocks.list.mockResolvedValue(response([
      row({ id: '2', kind: 'PICKUP', status: 'CONFIRMED' }),
      row({ id: '3', kind: 'PICKUP', status: 'CONFIRMED', scheduledFor: '2026-10-19T14:00:00Z' }),
      row({ id: '4', kind: 'PICKUP', status: 'CONFIRMED', scheduledFor: null }),
      row({ id: '5', kind: 'PICKUP', status: 'PENDING', scheduledFor: null }),
    ]));
    const store = useReservationsStore(); await store.load(); expect(store.pickupDue.map(item => item.id)).toEqual(['2', '4']);
    expect(store.reservations).toEqual([]);
    expect(store.pending).toEqual([]);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('does not let a stale poll overwrite a committed confirmation', async () => {
    const old = deferred<ReturnType<typeof response>>(); mocks.list.mockReturnValueOnce(old.promise).mockResolvedValue(response([row({ status: 'CONFIRMED' })]));
    mocks.update.mockResolvedValue(row({ status: 'CONFIRMED' }));
    const store = useReservationsStore(); const poll = store.load(); await store.act(row(), { action: 'CONFIRM' });
    old.resolve(response([row()])); await poll; expect(store.reservations[0].status).toBe('CONFIRMED');
  });
  it('keeps pickup requests out of dining lists and pending badges when IDs overlap', async () => {
    mocks.list.mockResolvedValue(response([row(), row({ kind: 'PICKUP' }), row({ id: '2', kind: 'PICKUP', status: 'CONFIRMED' })]));
    const store = useReservationsStore(); await store.load();
    expect(store.reservations.map(item => item.kind)).toEqual(['DINE_IN']);
    expect(store.pending).toHaveLength(1);
    expect(store.pickupDue.map(item => item.id)).toEqual(['2']);
    expect(mocks.sound).toHaveBeenCalledWith(['1'], 'reservations:3');
  });
  it('surfaces reservation unread alerts, keeps closed history and clears only the selected reservation', async () => {
    const chat = { id: 'chat-1', status: 'ACTIVE' as const, merchantUnreadCount: 2, customerUnreadCount: 0 };
    mocks.list.mockResolvedValue(response([row({ chatConversation: chat }), row({ id: '2', status: 'CANCELLED', chatConversation: { ...chat, id: 'chat-2', status: 'CLOSED' } }), row({ kind: 'PICKUP', chatConversation: chat })]));
    const store = useReservationsStore(); await store.load();
    expect(store.unread.map(item => item.id)).toEqual(['1', '2']);
    expect(store.attentionCount).toBe(2);
    store.updateChatSummary('1', { ...chat, merchantUnreadCount: 0 });
    expect(store.unread.map(item => item.id)).toEqual(['2']);
    expect(store.attentionCount).toBe(2); // the first still awaits confirmation
    store.reset(); expect(store.unread).toEqual([]);
  });

  it('discards responses after logout or switching merchants', async () => {
    const old = deferred<ReturnType<typeof response>>(); mocks.list.mockReturnValue(old.promise);
    const store = useReservationsStore(); const poll = store.load(); store.reset(); mocks.auth.merchant = { id: '8' };
    old.resolve(response([row()])); await poll; expect(store.reservations).toEqual([]);
  });
  it('does not clear another merchant state when an earlier mutation returns', async () => {
    const old = deferred<ArrivalReservation>(); mocks.update.mockReturnValue(old.promise);
    const store = useReservationsStore(); const mutation = store.act(row(), { action: 'CONFIRM' });
    store.reset(); mocks.auth.merchant = { id: '8' }; old.resolve(row({ status: 'CONFIRMED' })); await mutation;
    expect(store.reservations).toEqual([]); expect(store.actionId).toBe('');
  });
});
