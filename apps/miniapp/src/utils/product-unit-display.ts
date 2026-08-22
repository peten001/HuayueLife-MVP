export type ProductUnit = string | null | undefined;

export function normalizeProductUnit(unit: ProductUnit) {
  return unit?.trim() ?? '';
}

export function formatProductUnitSuffix(unit: ProductUnit) {
  const normalized = normalizeProductUnit(unit);
  return normalized ? `/ ${normalized}` : '';
}

export function formatCartQuantity(quantity: number, unit: ProductUnit) {
  const normalized = normalizeProductUnit(unit);
  return normalized ? `${quantity} ${normalized}` : String(quantity);
}
