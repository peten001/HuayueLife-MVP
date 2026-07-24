import {
  CASHIER_API_ACTIVITY_EVENT,
  CASHIER_UNAUTHORIZED_EVENT,
  cashierConfig,
  cashierStorageKeys,
} from '@/config';
import type { ApiActivityDetail, ApiResponse } from '@/types';
import { readCashierStorage } from '@/platform/safe-storage';
import { CashierApiError, normalizeApiErrorPayload } from './error';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  authenticated?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export async function requestApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    authenticated = true,
    body: requestBody,
    headers: requestHeaders,
    query,
    signal: externalSignal,
    ...requestInit
  } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort('timeout'), cashierConfig.requestTimeoutMs);
  const handleExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', handleExternalAbort, { once: true });

  try {
    const headers = new Headers(requestHeaders);
    headers.set('Accept', 'application/json');
    const token = readAccessToken();
    if (authenticated && token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    let body: BodyInit | undefined;
    if (requestBody !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(requestBody);
    }

    const response = await fetch(buildUrl(path, query), {
      ...requestInit,
      body,
      headers,
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const errorBody = normalizeApiErrorPayload(payload);
      const message = Array.isArray(errorBody?.message)
        ? errorBody.message.join('; ')
        : errorBody?.message || `HTTP ${response.status}`;
      const error = new CashierApiError({
        message,
        status: response.status,
        code: errorBody?.code || `HTTP_${response.status}`,
        requestId: errorBody?.requestId,
        details: errorBody,
      });
      reportFailure(error);
      if (response.status === 401 && authenticated) {
        dispatchWindowEvent(CASHIER_UNAUTHORIZED_EVENT);
      }
      throw error;
    }

    const envelope = payload as ApiResponse<T>;
    if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
      const error = new CashierApiError({
        message: 'Invalid API response',
        status: response.status,
        code: 'INVALID_API_RESPONSE',
      });
      reportFailure(error);
      throw error;
    }
    reportSuccess();
    return envelope.data;
  } catch (error) {
    if (error instanceof CashierApiError) throw error;
    const aborted = controller.signal.aborted;
    const normalized = new CashierApiError({
      message: aborted ? 'Request timeout or cancelled' : error instanceof Error ? error.message : 'Network error',
      code: aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
      details: error,
    });
    reportFailure(normalized);
    throw normalized;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', handleExternalAbort);
  }
}

function buildUrl(
  path: string,
  query: RequestOptions['query'],
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${cashierConfig.apiBaseUrl}${normalizedPath}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readAccessToken() {
  if (typeof window === 'undefined') return '';
  return readCashierStorage('local', cashierStorageKeys.accessToken)
    ?? readCashierStorage('session', cashierStorageKeys.accessToken)
    ?? '';
}

function reportSuccess() {
  dispatchActivity({ status: 'success', occurredAt: new Date().toISOString() });
}

function reportFailure(error: CashierApiError) {
  dispatchActivity({
    status: 'failure',
    occurredAt: new Date().toISOString(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    errorCode: error.code,
    statusCode: error.status || undefined,
  });
}

function dispatchActivity(detail: ApiActivityDetail) {
  dispatchWindowEvent(CASHIER_API_ACTIVITY_EVENT, detail);
}

function dispatchWindowEvent(name: string, detail?: unknown) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}
