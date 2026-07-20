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
  const itemAdjustmentKey = ITEM_ADJUSTMENT_ERROR_KEYS[error.code];
  if (itemAdjustmentKey) return itemAdjustmentKey;
  if (error.code === 'NETWORK_ERROR') return 'error.network';
  if (error.code === 'REQUEST_ABORTED') return 'error.requestTimeout';
  if (error.status === 401) return 'error.unauthorized';
  if (error.status === 403) return 'error.forbidden';
  if (error.status === 409) return 'error.conflict';
  if (error.status >= 500) return 'error.server';
  return fallback;
}

const ITEM_ADJUSTMENT_ERROR_KEYS: Record<string, string> = {
  ORDER_STATUS_CHANGED: 'itemAdjustment.orderStatusChanged',
  ORDER_ITEM_QUANTITY_CHANGED: 'itemAdjustment.quantityChanged',
  TABLE_SESSION_NOT_OPEN: 'itemAdjustment.tableSessionClosed',
  TABLE_SESSION_CLOSED: 'itemAdjustment.tableSessionClosed',
  TABLE_ALREADY_OPEN: 'itemAdjustment.tableAlreadyOpen',
  TABLE_NOT_AVAILABLE: 'itemAdjustment.tableSessionClosed',
  TABLE_NOT_FOUND: 'itemAdjustment.tableSessionClosed',
  ORDER_NOT_IN_TABLE_SESSION: 'itemAdjustment.orderStatusChanged',
  ORDER_TABLE_SESSION_MISMATCH: 'itemAdjustment.tableSessionMismatch',
  ORDER_NOT_FOUND: 'itemAdjustment.orderStatusChanged',
  LAST_ORDER_ITEM_RETURN_NOT_ALLOWED: 'itemAdjustment.lastItemReturnNotAllowed',
  INVALID_ITEM_QUANTITY: 'itemAdjustment.invalidQuantity',
  PRODUCT_NOT_AVAILABLE: 'ordering.productUnavailable',
  IDEMPOTENCY_KEY_CONFLICT: 'ordering.requestConflict',
  ORDER_ITEM_NOT_FOUND: 'itemAdjustment.itemNotFound',
  ADJUSTMENT_REQUEST_KEY_CONFLICT: 'itemAdjustment.requestConflict',
};

/**
 * A mutation response is uncertain when the server may have committed the write
 * even though the client did not receive a conclusive response. Callers must
 * retain the exact request key and payload for a same-request retry.
 */
export function isMutationOutcomeUncertain(error: unknown) {
  if (!(error instanceof CashierApiError)) return true;
  return !isDefinitiveMutationRejection(error);
}

/** Only a conclusive 4xx response may release a retained mutation key. */
export function isDefinitiveMutationRejection(error: unknown) {
  return error instanceof CashierApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429;
}

export function shouldRefreshAfterItemAdjustmentError(error: unknown) {
  return error instanceof CashierApiError && (
    error.status === 409
    || error.code === 'ORDER_ITEM_NOT_FOUND'
    || error.code === 'TABLE_SESSION_NOT_OPEN'
    || error.code === 'TABLE_ALREADY_OPEN'
    || error.code === 'TABLE_SESSION_CLOSED'
    || error.code === 'TABLE_NOT_AVAILABLE'
    || error.code === 'TABLE_NOT_FOUND'
  );
}

export function normalizeApiErrorPayload(value: unknown): ApiErrorResponse | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<ApiErrorResponse>;
  if (typeof payload.code !== 'string') return null;
  if (typeof payload.message !== 'string' && !Array.isArray(payload.message)) return null;
  return payload as ApiErrorResponse;
}
