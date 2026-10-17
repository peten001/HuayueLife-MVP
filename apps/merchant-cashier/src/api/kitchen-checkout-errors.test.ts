import { describe, expect, it } from 'vitest';
import { apiErrorTranslationKey, CashierApiError } from './error';
import { zhMessages, viMessages, enMessages } from '@/i18n/messages';

describe('kitchen checkout errors', () => {
  it.each([
    ['KDS_CHECKOUT_MAKING_REQUIRED', 'table.kitchenMakingRequired'],
    ['KDS_CHECKOUT_SERVING_REQUIRED', 'table.kitchenServingRequired'],
  ])('explains %s in all cashier languages', (code, expected) => {
    const key = apiErrorTranslationKey(new CashierApiError({ status: 409, code, message: 'kitchen check' }));
    expect(key).toBe(expected);
    for (const messages of [zhMessages, viMessages, enMessages]) expect(messages[key as keyof typeof zhMessages]).toBeTruthy();
  });
});
