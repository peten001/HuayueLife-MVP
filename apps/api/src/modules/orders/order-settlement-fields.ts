export type OrderSettlementSource = {
  totalAmountVnd: bigint | number;
  roundingAmountVnd?: bigint | null;
  roundingAppliedByStaffId?: bigint | null;
  roundingAppliedAt?: Date | null;
};

export function withOrderSettlementFields<T extends OrderSettlementSource>(
  order: T,
) {
  const roundingAmountVnd = order.roundingAmountVnd ?? 0n;
  const originalAmountVnd =
    typeof order.totalAmountVnd === 'bigint'
      ? order.totalAmountVnd
      : BigInt(order.totalAmountVnd);
  if (originalAmountVnd < 0n || roundingAmountVnd < 0n) {
    throw new RangeError('Order amount cannot be negative');
  }
  if (roundingAmountVnd > originalAmountVnd) {
    throw new RangeError('Order rounding cannot exceed the original amount');
  }
  return {
    ...order,
    originalAmountVnd,
    roundingAmountVnd,
    payableAmountVnd: originalAmountVnd - roundingAmountVnd,
    roundingApplied: order.roundingAppliedByStaffId != null,
    roundingAppliedByStaffId: order.roundingAppliedByStaffId ?? null,
    roundingAppliedAt: order.roundingAppliedAt ?? null,
  };
}
