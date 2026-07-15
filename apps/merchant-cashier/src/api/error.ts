import type { ApiErrorResponse } from '@/types';

export class CashierApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = 'CashierApiError';
    this.status = input.status ?? 0;
    this.code = input.code ?? 'UNKNOWN_ERROR';
    this.requestId = input.requestId;
    this.details = input.details;
  }
}

export function messageFromApiError(error: unknown) {
  if (error instanceof CashierApiError) return error.message;
  return error instanceof Error ? error.message : 'Unknown error';
}

export function apiErrorTranslationKey(
  error: unknown,
  fallback = 'error.operationFailed',
) {
  if (!(error instanceof CashierApiError)) return fallback;
  if (error.code === 'TABLE_SESSION_HAS_UNFINISHED_ORDERS') {
    return 'table.closeConflict';
  }
  if (error.code === 'NETWORK_ERROR') return 'error.network';
  if (error.code === 'REQUEST_ABORTED') return 'error.requestTimeout';
  if (error.status === 401) return 'error.unauthorized';
  if (error.status === 403) return 'error.forbidden';
  if (error.status === 409) return 'error.conflict';
  if (error.status >= 500) return 'error.server';
  return fallback;
}

export function normalizeApiErrorPayload(value: unknown): ApiErrorResponse | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<ApiErrorResponse>;
  if (typeof payload.code !== 'string') return null;
  if (typeof payload.message !== 'string' && !Array.isArray(payload.message)) return null;
  return payload as ApiErrorResponse;
}
