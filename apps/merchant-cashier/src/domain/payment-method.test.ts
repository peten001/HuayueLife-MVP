import { describe, expect, it } from 'vitest';
import { enMessages, viMessages, zhMessages } from '@/i18n/messages';
import { paymentMethodDisplayKey } from './payment-method';

describe('paymentMethodDisplayKey', () => {
  it('maps CASH and BANK_TRANSFER to their locale keys', () => {
    expect(paymentMethodDisplayKey('CASH')).toBe('payment.cash');
    expect(paymentMethodDisplayKey('BANK_TRANSFER')).toBe('payment.bankTransfer');
  });

  it('maps null, missing and undefined to the unrecorded key', () => {
    expect(paymentMethodDisplayKey(null)).toBe('summary.unrecorded');
    expect(paymentMethodDisplayKey(undefined)).toBe('summary.unrecorded');
  });

  it('never mistakes unknown future enums for cash', () => {
    expect(paymentMethodDisplayKey('CRYPTO' as never)).toBe('summary.unrecorded');
    expect(paymentMethodDisplayKey('CASH_V2' as never)).toBe('summary.unrecorded');
  });
});

describe('payment method i18n coverage', () => {
  it.each(['zh', 'vi', 'en'] as const)('provides all payment display keys in %s', (locale) => {
    const dictionary = (locale === 'zh' ? zhMessages : locale === 'vi' ? viMessages : enMessages) as Record<string, string>;
    expect(dictionary['payment.methodLabel']).toBeTruthy();
    expect(dictionary['payment.cash']).toBeTruthy();
    expect(dictionary['payment.bankTransfer']).toBeTruthy();
    expect(dictionary['summary.unrecorded']).toBeTruthy();
  });
});
