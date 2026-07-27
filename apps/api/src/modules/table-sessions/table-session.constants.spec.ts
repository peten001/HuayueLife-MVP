import {
  calculateRoundingAmounts,
  calculateTableSessionRoundingAmount,
  TABLE_SESSION_ROUNDING_UNIT_VND,
} from './table-session.constants';

describe('table session rounding policy', () => {
  it('rounds down to the nearest 10,000 VND by removing the tail below it', () => {
    expect(TABLE_SESSION_ROUNDING_UNIT_VND).toBe(10_000n);
    expect([
      [513_000n, 3_000n],
      [511_000n, 1_000n],
      [510_000n, 0n],
      [509_500n, 9_500n],
    ].map(([total]) => calculateTableSessionRoundingAmount(total))).toEqual([
      3_000n,
      1_000n,
      0n,
      9_500n,
    ]);
  });

  it('rejects negative amounts instead of inventing a payable value', () => {
    expect(() => calculateTableSessionRoundingAmount(-1n)).toThrow(RangeError);
  });

  it('returns one shared original, rounding, and payable amount result', () => {
    expect(calculateRoundingAmounts(513_000n)).toEqual({
      originalAmountVnd: 513_000n,
      roundingAmountVnd: 3_000n,
      payableAmountVnd: 510_000n,
    });
    expect(calculateRoundingAmounts(510_000n)).toEqual({
      originalAmountVnd: 510_000n,
      roundingAmountVnd: 0n,
      payableAmountVnd: 510_000n,
    });
  });
});
