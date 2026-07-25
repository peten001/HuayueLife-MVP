/** The cashier removes only the tail below the ten-thousand VND place. */
export const TABLE_SESSION_ROUNDING_UNIT_VND = 10_000n;

export function calculateTableSessionRoundingAmount(totalAmountVnd: bigint): bigint {
  if (totalAmountVnd < 0n) {
    throw new RangeError('Table session amount cannot be negative');
  }
  return totalAmountVnd % TABLE_SESSION_ROUNDING_UNIT_VND;
}
