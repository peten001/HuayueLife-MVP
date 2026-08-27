import { describe, expect, it } from 'vitest';
import { formatItemPrice, formatVnd, formatVietnamDateFilter, formatVietnamDateFilterAria } from './format';

describe('history date filter formatting', () => {
  it('shows month/day while retaining a full accessible date', () => {
    expect(formatVietnamDateFilter('2026-07-27', 'zh')).toBe('07/27');
    expect(formatVietnamDateFilter('2026-07-27', 'vi')).toBe('27/07');
    expect(formatVietnamDateFilter('2026-07-27', 'en')).toBe('07/27');
    expect(formatVietnamDateFilterAria('2026-07-27', 'zh')).toBe('2026年7月27日');
    expect(formatVietnamDateFilterAria('2026-07-27', 'vi')).toBe('27/07/2026');
    expect(formatVietnamDateFilterAria('2026-07-27', 'en')).toBe('July 27, 2026');
  });
});

describe('VND formatting', () => {
  it('formats string, number and bigint amounts without decimal currency units', () => {
    expect(formatVnd('1234567', 'vi')).toBe('1.234.567 ₫');
    expect(formatVnd(1234567, 'zh')).toBe('1,234,567 VND');
    expect(formatVnd(1234567n, 'en')).toBe('1,234,567 VND');
  });

  it('normalizes missing and invalid amounts to zero', () => {
    expect(formatVnd(null, 'vi')).toBe('0 ₫');
    expect(formatVnd(undefined, 'en')).toBe('0 VND');
    expect(formatVnd('not-a-number', 'zh')).toBe('0 VND');
  });

  it('does not introduce a non-Vietnamese currency symbol', () => {
    for (const locale of ['zh', 'vi', 'en'] as const) {
      expect(formatVnd('88000', locale)).not.toContain('¥');
      expect(formatVnd('88000', locale)).not.toContain('$');
    }
  });
});

describe('item price formatting', () => {
  it('formats a dish price without a currency suffix in every Cashier locale', () => {
    expect(formatItemPrice('68000', 'zh')).toBe('68,000');
    expect(formatItemPrice('68000', 'en')).toBe('68,000');
    expect(formatItemPrice('68000', 'vi')).toBe('68.000');
  });

  it('keeps invalid item-price input safe without inventing a currency marker', () => {
    expect(formatItemPrice('not-a-number', 'zh')).toBe('0');
    expect(formatItemPrice(undefined, 'vi')).toBe('0');
  });
});
