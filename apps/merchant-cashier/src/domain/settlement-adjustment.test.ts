import { describe, expect, it } from 'vitest';
import {
  formatDiscountAmountInput,
  formatDiscountPercentageFromAmount,
  formatDiscountPercentageInput,
  normalizeDiscountAmountInput,
  parseDiscountAmountInput,
  parseDiscountPercentageInput,
  previewSettlementAdjustment,
} from './settlement-adjustment';

describe('cashier discount percentage input', () => {
  it.each([
    ['0', null],
    ['10', 9_000],
    ['12.5', 8_750],
    ['7.25', 9_275],
    ['100', 0],
  ])('parses %s%% as the expected payable bps without floating point math', (value, expected) => {
    expect(parseDiscountPercentageInput(value)).toEqual({
      ok: true,
      discountPayableRateBps: expected,
    });
  });

  it.each(['', '100.01', '101', '-1', '8.555', 'abc'])('rejects %s', (value) => {
    expect(parseDiscountPercentageInput(value).ok).toBe(false);
  });

  it('formats persisted payable rates as discount percentages', () => {
    expect(formatDiscountPercentageInput(null)).toBe('0');
    expect(formatDiscountPercentageInput(9_000)).toBe('10');
    expect(formatDiscountPercentageInput(8_500)).toBe('15');
    expect(formatDiscountPercentageInput(9_275)).toBe('7.25');
  });
});

describe('cashier fixed VND discount input', () => {
  it('normalizes and parses a grouped integer amount', () => {
    expect(normalizeDiscountAmountInput('0016000')).toBe('16,000');
    expect(formatDiscountAmountInput('31600')).toBe('31,600');
    expect(parseDiscountAmountInput('16,000', '316000')).toEqual({
      ok: true,
      discountAmountVnd: '16000',
    });
  });

  it.each(['', '-1', 'VND 16000'])('rejects malformed fixed amount %s', (value) => {
    expect(parseDiscountAmountInput(value, '316000').ok).toBe(false);
  });

  it('rejects a fixed amount above the item amount', () => {
    expect(parseDiscountAmountInput('316001', '316000')).toEqual({
      ok: false,
      error: 'RANGE',
    });
  });

  it('derives a readable percentage when switching from an exact amount', () => {
    expect(formatDiscountPercentageFromAmount('316000', '31600')).toBe('10');
  });

  it('keeps a fixed VND discount exact in preview', () => {
    expect(previewSettlementAdjustment({
      itemAmountVnd: '316000',
      discountPayableRateBps: null,
      discountAmountVnd: '16000',
      roundingEnabled: false,
    })).toMatchObject({
      discountAmountVnd: '16000',
      afterDiscountAmountVnd: '300000',
      payableAmountVnd: '300000',
    });
  });
});

describe('cashier settlement preview', () => {
  it('applies percentage discount before delivery fee and rounding', () => {
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
