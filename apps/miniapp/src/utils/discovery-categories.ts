import type { ExploreCategory } from '@/types/api';
import type { HomeCategoryKey, HomeRegionCode } from '@/pages/home/home-list-state';

export const discoveryIcons: Record<string, string> = {
  food: '🍲', coffee: '🥤', massage: '💆', hotel: '🏨', ktv: '🎤',
  beauty: '✂️', shop: '🛒', fresh: '💐', sport: '🚴', all: '🗂️',
  chinese: '🥢', noodles: '🍜', vietnamese: '🍽️', flowers: '💐', fruit: '🍎',
  japanese: '🍣', thai: '🥘', seafood: '🦐', korean: '🍱', western: '🥩', hotpot: '🍲', barbecue: '🍢', buffet: '🍽️', bakery: '🍰', fastfood: '🥪', vegetarian: '🥗',
};

const categoryArtwork: Record<string, { iconKey: string; artwork: string }> = {
  popular_food: { iconKey: 'food', artwork: 'popular' },
  sichuan_hunan: { iconKey: 'chinese', artwork: 'spicy' },
};

const artworkNames = new Set(['food', 'coffee', 'massage', 'hotel', 'ktv', 'beauty', 'shop', 'fresh', 'sport', 'chinese', 'noodles', 'vietnamese', 'popular', 'japanese', 'thai', 'seafood', 'korean', 'hotpot', 'barbecue', 'bakery', 'spicy', 'flowers', 'fruit']);

/** Dedicated illustrations distinguish categories even when their configured icon key is shared. */
export function discoveryCategoryArtwork(category: ExploreCategory) {
  const variant = categoryArtwork[category.code];
  const name = variant?.iconKey === category.iconKey ? variant.artwork : category.iconKey;
  return artworkNames.has(name) ? `/static/category-icons/${name}.png` : '';
}

export const discoveryLeaves: Array<{ key: HomeCategoryKey; icon: string; labelKey:
  'homeCategoryPopular' | 'homeCategoryChinese' | 'homeCategoryNoodles' | 'homeCategoryDrinks'
  | 'homeCategoryFlowers' | 'homeCategoryFresh' | 'homeCategoryConvenience' | 'homeCategoryVietnamese' }> = [
  { key: 'popular_food', icon: '🍲', labelKey: 'homeCategoryPopular' },
  { key: 'chinese_dining', icon: '🥢', labelKey: 'homeCategoryChinese' },
  { key: 'noodles_snacks', icon: '🍜', labelKey: 'homeCategoryNoodles' },
  { key: 'coffee_milk_tea', icon: '🥤', labelKey: 'homeCategoryDrinks' },
  { key: 'flowers_gifts', icon: '💐', labelKey: 'homeCategoryFlowers' },
  { key: 'fresh_fruit', icon: '🍎', labelKey: 'homeCategoryFresh' },
  { key: 'convenience_store', icon: '🛒', labelKey: 'homeCategoryConvenience' },
  { key: 'vietnamese_food', icon: '🍽️', labelKey: 'homeCategoryVietnamese' },
];

/** Each enabled category appears once across native two-row pages, with no All services shortcut. */
export function discoveryCategoryPages(categories: ExploreCategory[]) {
  const industries = categories.filter(item => item.enabled && !item.navigationOnly);
  return Array.from({ length: Math.ceil(industries.length / 10) }, (_, index) => industries.slice(index * 10, (index + 1) * 10));
}

export function discoverySubcategories(category?: ExploreCategory) {
  return category ? discoveryLeaves.filter(item => category.legacyKeys.includes(item.key)) : [];
}

export function discoveryPageUrl(category: ExploreCategory, region?: string, subcategory?: HomeCategoryKey) {
  const params = [`category=${encodeURIComponent(category.code)}`];
  if (region === 'Bac Giang' || region === 'Bac Ninh') params.push(`region=${encodeURIComponent(region)}`);
  if (subcategory && category.legacyKeys.includes(subcategory)) params.push(`subcategory=${encodeURIComponent(subcategory)}`);
  return `/pages/discovery/index?${params.join('&')}`;
}

export type DiscoverySelection = {
  category: ExploreCategory;
  region: HomeRegionCode;
  subcategory?: string;
  keyword?: string;
  openOnly?: boolean;
};

export function discoveryRegion(value: unknown): HomeRegionCode | '' {
  let normalized = String(value || '');
  try { normalized = decodeURIComponent(normalized); } catch { return ''; }
  return normalized === 'Bac Giang' || normalized === 'Bac Ninh' ? normalized : '';
}

/** Category search stays within the chosen city and parent; pagination repeats the same filters. */
export function discoveryMerchantQuery(selection: DiscoverySelection, page: number) {
  const leaf = discoverySubcategories(selection.category).find(item => item.key === selection.subcategory);
  return {
    page,
    province: selection.region === 'Bac Ninh' ? '北宁' : '北江',
    exploreCategory: selection.category.code,
    ...(leaf ? { homepageCategoryKey: leaf.key } : {}),
    ...(selection.keyword?.trim() ? { keyword: selection.keyword.trim() } : {}),
    ...(selection.openOnly ? { serviceFilter: ['OPEN'] as Array<'OPEN'> } : {}),
  };
}

/** Keep previously shared links working after merging the visible categories. */
export function discoveryFlatCategoryCode(categories: ExploreCategory[], categoryCode: string, legacyKey: string) {
  if (!legacyKey) return categoryCode;
  const aliases: Record<string, string> = { coffee_milk_tea: 'coffee', convenience_store: 'shop' };
  const target = aliases[legacyKey] || legacyKey;
  return categories.some(item => item.enabled && !item.navigationOnly && item.code === target) ? target : categoryCode;
}
