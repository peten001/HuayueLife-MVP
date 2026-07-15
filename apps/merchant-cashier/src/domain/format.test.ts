import { describe, expect, it } from 'vitest';
import { formatVnd } from './format';

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
