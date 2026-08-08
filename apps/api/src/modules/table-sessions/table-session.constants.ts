import {
  calculateSettlementAdjustment,
  SETTLEMENT_ROUNDING_UNIT_VND,
} from '../orders/settlement-adjustment';

/** The cashier removes only the tail below the ten-thousand VND place. */
export const TABLE_SESSION_ROUNDING_UNIT_VND = SETTLEMENT_ROUNDING_UNIT_VND;

export type RoundingAmounts = {
  originalAmountVnd: bigint;
  roundingAmountVnd: bigint;
  payableAmountVnd: bigint;
};

export function calculateRoundingAmounts(
  originalAmountVnd: bigint,
): RoundingAmounts {
  const amounts = calculateSettlementAdjustment({
    itemAmountVnd: originalAmountVnd,
    discountPayableRateBps: null,
    roundingEnabled: true,
  });
  return {
    originalAmountVnd,
    roundingAmountVnd: amounts.roundingAmountVnd,
    payableAmountVnd: amounts.payableAmountVnd,
  };
}

export function calculateTableSessionRoundingAmount(totalAmountVnd: bigint): bigint {
  return calculateRoundingAmounts(totalAmountVnd).roundingAmountVnd;
}
