export type DiscountInputMode = 'PERCENTAGE' | 'FIXED_AMOUNT';

export type DiscountPercentageParseResult =
  | { ok: true; discountPayableRateBps: number | null }
  | { ok: false; error: 'REQUIRED' | 'FORMAT' | 'RANGE' };

export type DiscountAmountParseResult =
  | { ok: true; discountAmountVnd: string }
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

export function parseDiscountPercentageInput(value: string): DiscountPercentageParseResult {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return { ok: false, error: 'REQUIRED' };
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, error: 'FORMAT' };
  }
  const [wholePart, decimalPart = ''] = normalized.split('.');
  const whole = Number(wholePart);
  if (whole > 100 || (whole === 100 && /[1-9]/.test(decimalPart))) {
    return { ok: false, error: 'RANGE' };
  }
  const discountHundredths = whole * 100 + Number(decimalPart.padEnd(2, '0'));
  return {
    ok: true,
    discountPayableRateBps: discountHundredths === 0
      ? null
      : 10_000 - discountHundredths,
  };
}

export function formatDiscountPercentageInput(rate: number | null | undefined) {
  const discountHundredths = rate === null || rate === undefined
    ? 0
    : Math.max(0, Math.min(10_000, 10_000 - rate));
  const whole = Math.trunc(discountHundredths / 100);
  const fraction = String(discountHundredths % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function normalizeDiscountAmountInput(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseDiscountAmountInput(
  value: string,
  itemAmountVnd: string | number | bigint,
): DiscountAmountParseResult {
  const normalized = value.trim();
  if (!normalized) return { ok: false, error: 'REQUIRED' };
  if (!/^[\d\s.,]+$/.test(normalized)) return { ok: false, error: 'FORMAT' };
  const digits = normalized.replace(/[\s.,]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'FORMAT' };
  const amount = BigInt(digits);
  if (amount > BigInt(itemAmountVnd)) return { ok: false, error: 'RANGE' };
  return { ok: true, discountAmountVnd: amount.toString() };
}

export function formatDiscountAmountInput(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined) return '0';
  return normalizeDiscountAmountInput(String(value));
}

export function formatDiscountPercentageFromAmount(
  itemAmountVnd: string | number | bigint,
  discountAmountVnd: string | number | bigint,
) {
  const itemAmount = BigInt(itemAmountVnd);
  if (itemAmount <= 0n) return '0';
  const amount = BigInt(discountAmountVnd);
  const discountHundredths = Number(
    ((amount * 10_000n) + (itemAmount / 2n)) / itemAmount,
  );
  return formatDiscountPercentageInput(10_000 - Math.min(10_000, discountHundredths));
}

export function previewSettlementAdjustment(input: {
  itemAmountVnd: string | number | bigint;
  nonDiscountableFeeVnd?: string | number | bigint;
  discountPayableRateBps: number | null;
  discountAmountVnd?: string | number | bigint;
  roundingEnabled: boolean;
}): SettlementAdjustmentPreview {
  const itemAmountVnd = BigInt(input.itemAmountVnd);
  const nonDiscountableFeeVnd = BigInt(input.nonDiscountableFeeVnd ?? 0);
  const explicitDiscountAmountVnd = input.discountAmountVnd === undefined
    ? null
    : BigInt(input.discountAmountVnd);
  const rate = BigInt(input.discountPayableRateBps ?? 10_000);
  const discountAmountVnd = explicitDiscountAmountVnd === null
    ? itemAmountVnd - ((itemAmountVnd * rate + 5_000n) / 10_000n)
    : explicitDiscountAmountVnd;
  const afterDiscountAmountVnd = itemAmountVnd - discountAmountVnd;
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
