/** The cashier removes only the tail below the ten-thousand VND place. */
export const TABLE_SESSION_ROUNDING_UNIT_VND = 10_000n;

export type RoundingAmounts = {
  originalAmountVnd: bigint;
  roundingAmountVnd: bigint;
  payableAmountVnd: bigint;
};

export function calculateRoundingAmounts(
  originalAmountVnd: bigint,
): RoundingAmounts {
  if (originalAmountVnd < 0n) {
    throw new RangeError('Amount cannot be negative');
  }
  const roundingAmountVnd =
    originalAmountVnd % TABLE_SESSION_ROUNDING_UNIT_VND;
  return {
    originalAmountVnd,
    roundingAmountVnd,
    payableAmountVnd: originalAmountVnd - roundingAmountVnd,
  };
}

export function calculateTableSessionRoundingAmount(totalAmountVnd: bigint): bigint {
  return calculateRoundingAmounts(totalAmountVnd).roundingAmountVnd;
}
