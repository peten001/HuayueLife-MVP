import { describe, expect, it } from 'vitest';
import {
  formatDiscountRateInput,
  parseDiscountRateInput,
  previewSettlementAdjustment,
} from './settlement-adjustment';

describe('cashier discount rate input', () => {
  it.each([
    ['10', null],
    ['9', 9_000],
    ['8.5', 8_500],
    ['9.25', 9_250],
    ['0', 0],
  ])('parses %s 折 without floating point math', (value, expected) => {
    expect(parseDiscountRateInput(value)).toEqual({
      ok: true,
      discountPayableRateBps: expected,
    });
  });

  it.each(['', '10.01', '11', '-1', '8.555', 'abc'])('rejects %s', (value) => {
    expect(parseDiscountRateInput(value).ok).toBe(false);
  });

  it('formats persisted rates for editing', () => {
    expect(formatDiscountRateInput(null)).toBe('10');
    expect(formatDiscountRateInput(9_000)).toBe('9');
    expect(formatDiscountRateInput(8_500)).toBe('8.5');
    expect(formatDiscountRateInput(9_250)).toBe('9.25');
  });

  it('previews delivery discount before fee and rounding', () => {
    expect(previewSettlementAdjustment({
      itemAmountVnd: '1000000',
      nonDiscountableFeeVnd: '30000',
      discountPayableRateBps: 9_000,
      roundingEnabled: true,
    })).toMatchObject({
      discountAmountVnd: '100000',
      afterDiscountAmountVnd: '900000',
      roundingAmountVnd: '0',
      payableAmountVnd: '930000',
    });
  });
});
