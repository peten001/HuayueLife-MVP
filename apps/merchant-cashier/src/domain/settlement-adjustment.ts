export type DiscountRateParseResult =
  | { ok: true; discountPayableRateBps: number | null }
  | { ok: false; error: 'REQUIRED' | 'FORMAT' | 'RANGE' };

export type SettlementAdjustmentPreview = {
  itemAmountVnd: string;
  nonDiscountableFeeVnd: string;
  discountAmountVnd: string;
  afterDiscountAmountVnd: string;
  beforeRoundingAmountVnd: string;
  roundingAmountVnd: string;
  payableAmountVnd: string;
};

export function parseDiscountRateInput(value: string): DiscountRateParseResult {
  const normalized = value.trim();
  if (!normalized) return { ok: false, error: 'REQUIRED' };
  if (!/^(?:\d|10)(?:\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, error: 'FORMAT' };
  }
  const [wholePart, decimalPart = ''] = normalized.split('.');
  const whole = Number(wholePart);
  if (whole > 10 || (whole === 10 && /[1-9]/.test(decimalPart))) {
    return { ok: false, error: 'RANGE' };
  }
  const thousandths = Number(decimalPart.padEnd(2, '0')) * 10;
  const rate = whole * 1_000 + thousandths;
  return {
    ok: true,
    discountPayableRateBps: rate === 10_000 ? null : rate,
  };
}

export function formatDiscountRateInput(rate: number | null | undefined) {
  if (rate === null || rate === undefined || rate === 10_000) return '10';
  const whole = Math.trunc(rate / 1_000);
  const fraction = String(rate % 1_000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function previewSettlementAdjustment(input: {
  itemAmountVnd: string | number | bigint;
  nonDiscountableFeeVnd?: string | number | bigint;
  discountPayableRateBps: number | null;
  roundingEnabled: boolean;
}): SettlementAdjustmentPreview {
  const itemAmountVnd = BigInt(input.itemAmountVnd);
  const nonDiscountableFeeVnd = BigInt(input.nonDiscountableFeeVnd ?? 0);
  const rate = BigInt(input.discountPayableRateBps ?? 10_000);
  const afterDiscountAmountVnd = (itemAmountVnd * rate + 5_000n) / 10_000n;
  const discountAmountVnd = itemAmountVnd - afterDiscountAmountVnd;
  const beforeRoundingAmountVnd = afterDiscountAmountVnd + nonDiscountableFeeVnd;
  const roundingAmountVnd = input.roundingEnabled
    ? beforeRoundingAmountVnd % 10_000n
    : 0n;
  const payableAmountVnd = beforeRoundingAmountVnd - roundingAmountVnd;
  return {
    itemAmountVnd: itemAmountVnd.toString(),
    nonDiscountableFeeVnd: nonDiscountableFeeVnd.toString(),
    discountAmountVnd: discountAmountVnd.toString(),
    afterDiscountAmountVnd: afterDiscountAmountVnd.toString(),
    beforeRoundingAmountVnd: beforeRoundingAmountVnd.toString(),
    roundingAmountVnd: roundingAmountVnd.toString(),
    payableAmountVnd: payableAmountVnd.toString(),
  };
}
