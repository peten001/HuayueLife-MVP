export const DINING_CATEGORY_DEFINITIONS = [
  { key: 'japanese_food', nameZh: '日本料理', nameVi: 'Món Nhật', nameEn: 'Japanese', iconKey: 'japanese' },
  { key: 'thai_food', nameZh: '泰国菜', nameVi: 'Món Thái', nameEn: 'Thai', iconKey: 'thai' },
  { key: 'seafood', nameZh: '海鲜', nameVi: 'Hải sản', nameEn: 'Seafood', iconKey: 'seafood' },
  { key: 'korean_food', nameZh: '韩国料理', nameVi: 'Món Hàn', nameEn: 'Korean', iconKey: 'korean' },
  { key: 'hotpot', nameZh: '火锅', nameVi: 'Lẩu', nameEn: 'Hotpot', iconKey: 'hotpot' },
  { key: 'barbecue', nameZh: '烧烤', nameVi: 'Đồ nướng', nameEn: 'Barbecue', iconKey: 'barbecue' },
  { key: 'bakery_desserts', nameZh: '面包甜品', nameVi: 'Bánh & đồ ngọt', nameEn: 'Bakery & desserts', iconKey: 'bakery' },
  { key: 'sichuan_hunan', nameZh: '川湘菜', nameVi: 'Tứ Xuyên & Hồ Nam', nameEn: 'Sichuan & Hunan', iconKey: 'chinese' },
] as const;

// Persisted Explore settings must not reintroduce retired category entrances.
export const RETIRED_HOMEPAGE_CATEGORY_KEYS: readonly string[] = [
  'western_food', 'buffet', 'fast_food', 'cantonese_food', 'northeastern_food', 'vegetarian_food',
];

export type HomepageCategoryKey =
  | 'popular_food'
  | 'chinese_dining'
  | 'noodles_snacks'
  | 'coffee_milk_tea'
  | 'flowers_gifts'
  | 'fresh_fruit'
  | 'convenience_store'
  | 'vietnamese_food'
  | typeof DINING_CATEGORY_DEFINITIONS[number]['key'];

export const HOMEPAGE_CATEGORY_KEYS: HomepageCategoryKey[] = [
  'popular_food',
  'chinese_dining',
  'noodles_snacks',
  'coffee_milk_tea',
  'flowers_gifts',
  'fresh_fruit',
  'convenience_store',
  'vietnamese_food',
  ...DINING_CATEGORY_DEFINITIONS.map(item => item.key),
];

const LEGACY_KEY_MAP: Record<string, HomepageCategoryKey> = {
  chinese: 'chinese_dining',
  noodles: 'noodles_snacks',
  drinks: 'coffee_milk_tea',
};

export function normalizeHomepageCategoryKey(value: unknown): HomepageCategoryKey | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isHomepageCategoryKey(trimmed)) return trimmed;
  return LEGACY_KEY_MAP[trimmed] ?? null;
}

export function parseHomepageCategoryKeys(value: unknown): HomepageCategoryKey[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseStringValues(value)
      : [];
  const normalized = rawValues
    .map((item) => normalizeHomepageCategoryKey(item))
    .filter((item): item is HomepageCategoryKey => Boolean(item));
  return Array.from(new Set(normalized));
}

export function stringifyHomepageCategoryKeys(value: string[] | undefined) {
  return JSON.stringify(parseHomepageCategoryKeys(value ?? []));
}

function parseStringValues(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to comma split
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function isHomepageCategoryKey(value: string): value is HomepageCategoryKey {
  return HOMEPAGE_CATEGORY_KEYS.includes(value as HomepageCategoryKey);
}
