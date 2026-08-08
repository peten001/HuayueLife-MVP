import {
  calculateSettlementAdjustment,
  normalizeDiscountPayableRateBps,
} from './settlement-adjustment';

describe('settlement adjustment calculator', () => {
  it('calculates a 90 percent payable rate with integer VND amounts', () => {
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 1_000_000n,
      discountPayableRateBps: 9_000,
      roundingEnabled: false,
    })).toMatchObject({
      discountedItemAmountVnd: 900_000n,
      discountAmountVnd: 100_000n,
      payableAmountVnd: 900_000n,
    });
  });

  it('uses HALF-UP rounding to the nearest one VND', () => {
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 123_457n,
      discountPayableRateBps: 8_500,
      roundingEnabled: false,
    }).discountedItemAmountVnd).toBe(104_938n);
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 1n,
      discountPayableRateBps: 5_000,
      roundingEnabled: false,
    }).discountedItemAmountVnd).toBe(1n);
  });

  it('normalizes no discount to null and permits a zero payable rate', () => {
    expect(normalizeDiscountPayableRateBps(10_000)).toBeNull();
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 513_000n,
      discountPayableRateBps: null,
      roundingEnabled: false,
    }).payableAmountVnd).toBe(513_000n);
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 513_000n,
      discountPayableRateBps: 0,
      roundingEnabled: false,
    }).payableAmountVnd).toBe(0n);
  });

  it('excludes delivery fee from discount and rounds only after adding it', () => {
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 1_000_000n,
      nonDiscountableFeeVnd: 30_000n,
      discountPayableRateBps: 9_000,
      roundingEnabled: true,
    })).toMatchObject({
      discountAmountVnd: 100_000n,
      discountedItemAmountVnd: 900_000n,
      beforeRoundingAmountVnd: 930_000n,
      roundingAmountVnd: 0n,
      payableAmountVnd: 930_000n,
    });
  });

  it('applies discount before rounding and keeps totals nonnegative below one unit', () => {
    expect(calculateSettlementAdjustment({
      itemAmountVnd: 15_001n,
      discountPayableRateBps: 5_000,
      roundingEnabled: true,
    })).toMatchObject({
      discountedItemAmountVnd: 7_501n,
      roundingAmountVnd: 7_501n,
      payableAmountVnd: 0n,
    });
  });

  it.each([-1, 10_001, 8_500.5])('rejects invalid rate %s', (rate) => {
    expect(() => normalizeDiscountPayableRateBps(rate)).toThrow(RangeError);
  });
});
