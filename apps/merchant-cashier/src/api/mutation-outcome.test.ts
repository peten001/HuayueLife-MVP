import { describe, expect, it } from 'vitest';
import {
  apiErrorTranslationKey,
  CashierApiError,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
} from './error';

describe('cashier mutation outcome classification', () => {
  it.each([
    new Error('transport failed'),
    new CashierApiError({ code: 'NETWORK_ERROR', message: 'offline' }),
    new CashierApiError({ code: 'REQUEST_ABORTED', message: 'aborted', status: 0 }),
    new CashierApiError({ code: 'HTTP_408', message: 'timeout', status: 408 }),
    new CashierApiError({ code: 'HTTP_429', message: 'throttled', status: 429 }),
    new CashierApiError({ code: 'HTTP_500', message: 'server failed', status: 500 }),
    new CashierApiError({ code: 'HTTP_503', message: 'unavailable', status: 503 }),
    new CashierApiError({ code: 'INVALID_API_RESPONSE', message: 'invalid response', status: 200 }),
  ])('keeps the same key after an uncertain outcome', (error) => {
    expect(isMutationOutcomeUncertain(error)).toBe(true);
    expect(isDefinitiveMutationRejection(error)).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'releases the key only after a definitive HTTP %s rejection',
    (status) => {
      const error = new CashierApiError({ code: `HTTP_${status}`, message: 'rejected', status });
      expect(isMutationOutcomeUncertain(error)).toBe(false);
      expect(isDefinitiveMutationRejection(error)).toBe(true);
    },
  );

  it('maps a table-session mismatch to the explicit adjustment message', () => {
    expect(apiErrorTranslationKey(new CashierApiError({
      code: 'ORDER_TABLE_SESSION_MISMATCH', message: 'mismatch', status: 409,
    }))).toBe('itemAdjustment.tableSessionMismatch');
  });
});
