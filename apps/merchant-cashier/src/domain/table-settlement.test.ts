import { describe, expect, it } from 'vitest';
import {
  calculateTableSessionRoundingAmount,
  TABLE_SESSION_ROUNDING_UNIT_VND,
} from './table-settlement';

describe('table settlement rounding policy', () => {
  it('rounds down to the nearest 10,000 VND', () => {
    expect(TABLE_SESSION_ROUNDING_UNIT_VND).toBe(10_000n);
    expect([
      [513_000n, 3_000n, 510_000n],
      [511_000n, 1_000n, 510_000n],
      [510_000n, 0n, 510_000n],
      [509_500n, 9_500n, 500_000n],
    ].map(([total]) => {
      const rounding = calculateTableSessionRoundingAmount(total);
      return [rounding, total - rounding];
    })).toEqual([
      [3_000n, 510_000n],
      [1_000n, 510_000n],
      [0n, 510_000n],
      [9_500n, 500_000n],
    ]);
  });

  it('rejects negative amounts', () => {
    expect(() => calculateTableSessionRoundingAmount(-1n)).toThrow(RangeError);
  });
});
