import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CASHIER_API_ACTIVITY_EVENT,
  CASHIER_UNAUTHORIZED_EVENT,
  cashierStorageKeys,
} from '@/config';
import type { ApiActivityDetail } from '@/types';
import { requestApi } from './http';

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({
    code: status < 400 ? 'OK' : `HTTP_${status}`,
    message: status < 400 ? 'OK' : 'Request failed',
    data,
    requestId: 'request-test',
    timestamp: '2026-07-15T00:00:00.000Z',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({
    code,
    message,
    data: null,
    requestId: 'request-error',
    timestamp: '2026-07-15T00:00:00.000Z',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cashier HTTP client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps the API envelope and sends the stored Bearer token', async () => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'cashier-test-token');
    fetchMock.mockResolvedValue(apiResponse({ id: 'merchant-1' }));

    await expect(requestApi<{ id: string }>('/merchant/profile')).resolves.toEqual({
      id: 'merchant-1',
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://localhost:3001/api/v1/merchant/profile');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer cashier-test-token');
  });

  it('does not attach credentials to an unauthenticated login request', async () => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'stale-token');
    fetchMock.mockResolvedValue(apiResponse({ accessToken: 'fresh-token' }));

    await requestApi('/merchant/auth/login', {
      method: 'POST',
      authenticated: false,
      body: { username: 'cashier', password: 'not-a-real-password' },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      username: 'cashier',
      password: 'not-a-real-password',
    });
  });

  it('normalizes an API error and dispatches the unauthorized event for 401', async () => {
    fetchMock.mockResolvedValue(apiError(401, 'UNAUTHORIZED', 'Token expired'));
    const unauthorized = vi.fn();
    const activity = vi.fn<(event: Event) => void>();
    window.addEventListener(CASHIER_UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener(CASHIER_API_ACTIVITY_EVENT, activity);

    try {
      await expect(requestApi('/merchant/me')).rejects.toMatchObject({
        name: 'CashierApiError',
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Token expired',
        requestId: 'request-error',
      });
      expect(unauthorized).toHaveBeenCalledOnce();
      const detail = (activity.mock.calls[0]?.[0] as CustomEvent<ApiActivityDetail>).detail;
      expect(detail).toMatchObject({
        status: 'failure',
        errorCode: 'UNAUTHORIZED',
        statusCode: 401,
      });
    } finally {
      window.removeEventListener(CASHIER_UNAUTHORIZED_EVENT, unauthorized);
      window.removeEventListener(CASHIER_API_ACTIVITY_EVENT, activity);
    }
  });

  it('does not emit session-expired for invalid credentials on the public login request', async () => {
    fetchMock.mockResolvedValue(apiError(401, 'HTTP_401', 'Invalid credentials'));
    const unauthorized = vi.fn();
    window.addEventListener(CASHIER_UNAUTHORIZED_EVENT, unauthorized);

    try {
      await expect(requestApi('/merchant/auth/login', {
        method: 'POST',
        authenticated: false,
        body: { username: 'cashier', password: 'not-a-real-password' },
      })).rejects.toMatchObject({ status: 401 });
      expect(unauthorized).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CASHIER_UNAUTHORIZED_EVENT, unauthorized);
    }
  });

  it('reports transport failures without converting them into HTTP errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const activity = vi.fn<(event: Event) => void>();
    window.addEventListener(CASHIER_API_ACTIVITY_EVENT, activity);

    try {
      await expect(requestApi('/merchant/tables')).rejects.toMatchObject({
        name: 'CashierApiError',
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Failed to fetch',
      });
      const detail = (activity.mock.calls[0]?.[0] as CustomEvent<ApiActivityDetail>).detail;
      expect(detail).toMatchObject({
        status: 'failure',
        errorCode: 'NETWORK_ERROR',
      });
    } finally {
      window.removeEventListener(CASHIER_API_ACTIVITY_EVENT, activity);
    }
  });
});
