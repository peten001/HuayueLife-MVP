export const SETTLEMENT_RATE_DENOMINATOR_BPS = 10_000;
export const SETTLEMENT_ROUNDING_UNIT_VND = 10_000n;

export type SettlementAdjustmentInput = {
  itemAmountVnd: bigint;
  nonDiscountableFeeVnd?: bigint;
  discountPayableRateBps: number | null;
  /** Exact client-requested deduction. Undefined keeps percentage calculation semantics. */
  discountAmountVnd?: bigint;
  roundingEnabled: boolean;
};

export type SettlementAdjustmentAmounts = {
  itemAmountVnd: bigint;
  nonDiscountableFeeVnd: bigint;
  discountPayableRateBps: number | null;
  discountedItemAmountVnd: bigint;
  discountAmountVnd: bigint;
  beforeRoundingAmountVnd: bigint;
  roundingAmountVnd: bigint;
  payableAmountVnd: bigint;
};

export function normalizeDiscountPayableRateBps(
  value: number | null,
): number | null {
  if (value === null || value === SETTLEMENT_RATE_DENOMINATOR_BPS) return null;
  if (!Number.isInteger(value) || value < 0 || value > SETTLEMENT_RATE_DENOMINATOR_BPS) {
    throw new RangeError('Discount payable rate must be an integer from 0 to 10000');
  }
  return value;
}

export function calculateSettlementAdjustment(
  input: SettlementAdjustmentInput,
): SettlementAdjustmentAmounts {
  const nonDiscountableFeeVnd = input.nonDiscountableFeeVnd ?? 0n;
  if (input.itemAmountVnd < 0n || nonDiscountableFeeVnd < 0n) {
    throw new RangeError('Settlement amounts cannot be negative');
  }
  const discountPayableRateBps = normalizeDiscountPayableRateBps(
    input.discountPayableRateBps,
  );
  const fixedDiscountAmountVnd = input.discountAmountVnd;
  if (fixedDiscountAmountVnd !== undefined) {
    if (discountPayableRateBps !== null) {
      throw new RangeError('Fixed discount and percentage discount cannot be combined');
    }
    if (fixedDiscountAmountVnd < 0n) {
      throw new RangeError('Fixed discount cannot be negative');
    }
  }
  const boundedFixedDiscountAmountVnd = fixedDiscountAmountVnd === undefined
    ? undefined
    : fixedDiscountAmountVnd > input.itemAmountVnd
      ? input.itemAmountVnd
      : fixedDiscountAmountVnd;
  const effectiveRate = BigInt(
    discountPayableRateBps ?? SETTLEMENT_RATE_DENOMINATOR_BPS,
  );
  const denominator = BigInt(SETTLEMENT_RATE_DENOMINATOR_BPS);
  const discountedItemAmountVnd = boundedFixedDiscountAmountVnd === undefined
    ? (input.itemAmountVnd * effectiveRate + denominator / 2n) / denominator
    : input.itemAmountVnd - boundedFixedDiscountAmountVnd;
  const discountAmountVnd = boundedFixedDiscountAmountVnd
    ?? input.itemAmountVnd - discountedItemAmountVnd;
  const beforeRoundingAmountVnd =
    discountedItemAmountVnd + nonDiscountableFeeVnd;
  const roundingAmountVnd = input.roundingEnabled
    ? beforeRoundingAmountVnd % SETTLEMENT_ROUNDING_UNIT_VND
    : 0n;
  const payableAmountVnd = beforeRoundingAmountVnd - roundingAmountVnd;

  return {
    itemAmountVnd: input.itemAmountVnd,
    nonDiscountableFeeVnd,
    discountPayableRateBps,
    discountedItemAmountVnd,
    discountAmountVnd,
    beforeRoundingAmountVnd,
    roundingAmountVnd,
    payableAmountVnd,
  };
}
