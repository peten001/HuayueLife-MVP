import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASHIER_API_ACTIVITY_EVENT } from '@/config';
import type { ApiActivityDetail } from '@/types';
import { useNetworkStore } from './network';

function dispatchActivity(detail: ApiActivityDetail) {
  window.dispatchEvent(new CustomEvent(CASHIER_API_ACTIVITY_EVENT, { detail }));
}

describe('cashier network state', () => {
  let browserOnline = true;

  beforeEach(() => {
    browserOnline = true;
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => browserOnline);
    setActivePinia(createPinia());
  });

  afterEach(() => {
    useNetworkStore().stop();
    vi.restoreAllMocks();
  });

  it('tracks browser disconnect and recovery without claiming API recovery early', () => {
    const store = useNetworkStore();
    store.start();

    browserOnline = false;
    window.dispatchEvent(new Event('offline'));
    expect(store.online).toBe(false);
    expect(store.apiReachable).toBe(false);
    expect(store.lastErrorCode).toBe('OFFLINE');

    browserOnline = true;
    window.dispatchEvent(new Event('online'));
    expect(store.online).toBe(true);
    expect(store.apiReachable).toBeNull();

    dispatchActivity({ status: 'success', occurredAt: '2026-07-15T00:00:00.000Z' });
    expect(store.apiReachable).toBe(true);
    expect(store.lastSuccessAt).toBe('2026-07-15T00:00:00.000Z');
  });

  it('distinguishes an answered business error from transport and server failures', () => {
    const store = useNetworkStore();
    store.start();

    dispatchActivity({
      status: 'failure',
      occurredAt: '2026-07-15T00:01:00.000Z',
      online: true,
      errorCode: 'ORDER_STATUS_CONFLICT',
      statusCode: 409,
    });
    expect(store.apiReachable).toBe(true);
    expect(store.lastErrorCode).toBe('ORDER_STATUS_CONFLICT');

    dispatchActivity({
      status: 'failure',
      occurredAt: '2026-07-15T00:02:00.000Z',
      online: true,
      errorCode: 'HTTP_503',
      statusCode: 503,
    });
    expect(store.apiReachable).toBe(false);

    dispatchActivity({
      status: 'failure',
      occurredAt: '2026-07-15T00:03:00.000Z',
      online: true,
      errorCode: 'NETWORK_ERROR',
    });
    expect(store.apiReachable).toBe(false);
    expect(store.degraded).toBe(true);
  });
});
