export type HomepageCategoryKey =
  | 'popular_food'
  | 'chinese_dining'
  | 'noodles_snacks'
  | 'coffee_milk_tea'
  | 'flowers_gifts'
  | 'fresh_fruit'
  | 'convenience_store'
  | 'vietnamese_food';

export const HOMEPAGE_CATEGORY_KEYS: HomepageCategoryKey[] = [
  'popular_food',
  'chinese_dining',
  'noodles_snacks',
  'coffee_milk_tea',
  'flowers_gifts',
  'fresh_fruit',
  'convenience_store',
  'vietnamese_food',
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
