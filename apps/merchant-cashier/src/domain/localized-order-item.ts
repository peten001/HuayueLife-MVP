import type { Locale } from '@/i18n';

export interface LocalizedOrderItemNameSource {
  productNameZhSnapshot?: string | null;
  productNameViSnapshot?: string | null;
  productNameEnSnapshot?: string | null;
  productNameZh?: string | null;
  productNameVi?: string | null;
  productNameEn?: string | null;
  productName?: string | null;
  name?: string | null;
}

export function resolveLocalizedOrderItemName(
  item: LocalizedOrderItemNameSource,
  locale: Locale,
  fallback: string,
) {
  const localized = locale === 'vi'
    ? [item.productNameViSnapshot, item.productNameVi]
    : locale === 'en'
      ? [item.productNameEnSnapshot, item.productNameEn]
      : [item.productNameZhSnapshot, item.productNameZh];
  return firstNonBlank(
    ...localized,
    item.productNameZhSnapshot,
    item.productName,
    item.name,
    item.productNameZh,
    item.productNameViSnapshot,
    item.productNameVi,
    item.productNameEnSnapshot,
    item.productNameEn,
    fallback,
  );
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) || '—';
}
