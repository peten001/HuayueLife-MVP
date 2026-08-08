export type OrderSettlementSource = {
  totalAmountVnd: bigint | number;
  itemAmountVnd?: bigint | number;
  deliveryFeeVnd?: bigint | number;
  discountPayableRateBps?: number | null;
  discountAmountVnd?: bigint | null;
  discountAppliedByStaffId?: bigint | null;
  discountAppliedAt?: Date | null;
  roundingAmountVnd?: bigint | null;
  roundingAppliedByStaffId?: bigint | null;
  roundingAppliedAt?: Date | null;
};

export function withOrderSettlementFields<T extends OrderSettlementSource>(
  order: T,
) {
  const roundingAmountVnd = order.roundingAmountVnd ?? 0n;
  const discountPayableRateBps = order.discountPayableRateBps ?? null;
  const discountAmountVnd = discountPayableRateBps === null
    ? 0n
    : order.discountAmountVnd ?? 0n;
  const originalAmountVnd =
    typeof order.totalAmountVnd === 'bigint'
      ? order.totalAmountVnd
      : BigInt(order.totalAmountVnd);
  if (
    originalAmountVnd < 0n ||
    discountAmountVnd < 0n ||
    roundingAmountVnd < 0n
  ) {
    throw new RangeError('Order amount cannot be negative');
  }
  if (discountAmountVnd > originalAmountVnd) {
    throw new RangeError('Order discount cannot exceed the original amount');
  }
  if (roundingAmountVnd > originalAmountVnd - discountAmountVnd) {
    throw new RangeError('Order rounding cannot exceed the discounted amount');
  }
  return {
    ...order,
    originalAmountVnd,
    discountPayableRateBps,
    discountAmountVnd,
    discountAppliedByStaffId: order.discountAppliedByStaffId ?? null,
    discountAppliedAt: order.discountAppliedAt ?? null,
    roundingAmountVnd,
    payableAmountVnd:
      originalAmountVnd - discountAmountVnd - roundingAmountVnd,
    roundingApplied: order.roundingAppliedByStaffId != null,
    roundingAppliedByStaffId: order.roundingAppliedByStaffId ?? null,
    roundingAppliedAt: order.roundingAppliedAt ?? null,
  };
}
