import { pinyin } from 'pinyin-pro';
import type { CashierMenuProduct } from '@/types';

type SearchableProduct = Pick<
  CashierMenuProduct,
  'nameZh' | 'nameVi' | 'nameEn' | 'description'
>;

interface ProductSearchIndex {
  direct: string[];
  folded: string[];
  compact: string[];
  initials: string[];
}

const HAN_PATTERN = /\p{Script=Han}/gu;

export function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

export function foldVietnameseText(value: string | null | undefined) {
  return normalizeSearchText(value)
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function buildProductSearchIndex(product: SearchableProduct): ProductSearchIndex {
  const direct = [product.nameZh, product.nameVi, product.nameEn, product.description]
    .map(normalizeSearchText)
    .filter(Boolean);
  const folded = direct.map(foldVietnameseText);
  const compact = [...direct, ...folded].map((value) => value.replace(/[\s\p{P}\p{S}]+/gu, ''));
  const wordInitials = folded.map((value) => value
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word[0])
    .join(''));
  const hanText = (product.nameZh.match(HAN_PATTERN) ?? []).join('');
  const pinyinSyllables = hanText
    ? pinyin(hanText, { toneType: 'none', type: 'array' }).map((syllable) => syllable.toLocaleLowerCase())
    : [];

  return {
    direct,
    folded,
    compact: [...compact, pinyinSyllables.join(''), pinyinSyllables.join(' ')].filter(Boolean),
    initials: [...wordInitials, pinyinSyllables.map((syllable) => syllable[0]).join('')].filter(Boolean),
  };
}

export function productMatchesQuery(product: SearchableProduct, rawQuery: string) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return true;
  const foldedQuery = foldVietnameseText(query);
  const compactQuery = foldedQuery.replace(/[\s\p{P}\p{S}]+/gu, '');
  const index = buildProductSearchIndex(product);

  return index.direct.some((value) => value.includes(query))
    || index.folded.some((value) => value.includes(foldedQuery))
    || index.compact.some((value) => value.includes(compactQuery))
    || index.initials.some((value) => value.startsWith(compactQuery));
}
