import { DINING_CATEGORY_DEFINITIONS, parseHomepageCategoryKeys } from '../shared/homepage-category-keys';

export const EXPLORE_ICONS = ['food', 'coffee', 'massage', 'hotel', 'ktv', 'beauty', 'shop', 'fresh', 'sport', 'all', 'chinese', 'noodles', 'vietnamese', 'flowers', 'fruit', 'japanese', 'thai', 'seafood', 'korean', 'western', 'hotpot', 'barbecue', 'buffet', 'bakery', 'fastfood', 'vegetarian'] as const;
export type ExploreCategory = {
  code: string; nameZh: string; nameVi?: string; nameEn?: string;
  iconKey: typeof EXPLORE_ICONS[number]; sortOrder: number; enabled: boolean;
  businessTypeCodes: string[]; legacyKeys: string[]; navigationOnly?: boolean;
};
export type ExploreTopic = {
  code: string; nameZh: string; nameVi?: string; nameEn?: string;
  subtitleZh?: string; subtitleVi?: string; subtitleEn?: string;
  imageUrl?: string; regions: string[]; categoryCode?: string; promotionTagCode?: string;
  sortOrder: number; enabled: boolean;
};

export const DEFAULT_EXPLORE_CATEGORIES: ExploreCategory[] = [
  { code: 'food', nameZh: '美食餐饮', nameVi: 'Ẩm thực', nameEn: 'Dining', iconKey: 'food', sortOrder: 10, enabled: true, businessTypeCodes: ['FOOD_SERVICE', 'CHINESE_RESTAURANT', 'NOODLE_SNACK', 'VIETNAMESE_FOOD'], legacyKeys: ['popular_food', 'chinese_dining', 'noodles_snacks', 'vietnamese_food'] },
  { code: 'coffee', nameZh: '咖啡茶饮', nameVi: 'Cà phê & trà', nameEn: 'Coffee & tea', iconKey: 'coffee', sortOrder: 20, enabled: true, businessTypeCodes: ['COFFEE_TEA'], legacyKeys: ['coffee_milk_tea'] },
  { code: 'massage', nameZh: '按摩足疗', nameVi: 'Massage', nameEn: 'Massage', iconKey: 'massage', sortOrder: 30, enabled: true, businessTypeCodes: ['MASSAGE_SPA'], legacyKeys: [] },
  { code: 'hotel', nameZh: '酒店住宿', nameVi: 'Khách sạn', nameEn: 'Hotels', iconKey: 'hotel', sortOrder: 40, enabled: true, businessTypeCodes: ['HOTEL'], legacyKeys: [] },
  { code: 'ktv', nameZh: 'KTV娱乐', nameVi: 'Karaoke', nameEn: 'Karaoke', iconKey: 'ktv', sortOrder: 50, enabled: true, businessTypeCodes: ['KTV'], legacyKeys: [] },
  { code: 'beauty', nameZh: '美发美容', nameVi: 'Làm đẹp', nameEn: 'Beauty', iconKey: 'beauty', sortOrder: 60, enabled: true, businessTypeCodes: ['HAIR_BEAUTY'], legacyKeys: [] },
  { code: 'shop', nameZh: '便利超市', nameVi: 'Siêu thị', nameEn: 'Shops', iconKey: 'shop', sortOrder: 70, enabled: true, businessTypeCodes: ['CONVENIENCE_MARKET'], legacyKeys: ['convenience_store'] },
  { code: 'fresh', nameZh: '鲜花生鲜', nameVi: 'Hoa & quả tươi', nameEn: 'Flowers & fresh', iconKey: 'fresh', sortOrder: 80, enabled: true, businessTypeCodes: ['FLOWER_GIFT', 'FRUIT_FRESH'], legacyKeys: ['flowers_gifts', 'fresh_fruit'] },
  { code: 'sport', nameZh: '运动休闲', nameVi: 'Thể thao', nameEn: 'Recreation', iconKey: 'sport', sortOrder: 90, enabled: true, businessTypeCodes: ['SPORT_LEISURE'], legacyKeys: [] },
  { code: 'all', nameZh: '全部服务', nameVi: 'Tất cả', nameEn: 'All services', iconKey: 'all', sortOrder: 100, enabled: true, businessTypeCodes: [], legacyKeys: [], navigationOnly: true },
  { code: 'chinese_dining', nameZh: '中式正餐', nameVi: 'Món Trung', nameEn: 'Chinese dining', iconKey: 'chinese', sortOrder: 110, enabled: true, businessTypeCodes: ['CHINESE_RESTAURANT'], legacyKeys: ['chinese_dining'] },
  { code: 'noodles_snacks', nameZh: '粉面小吃', nameVi: 'Mì & ăn vặt', nameEn: 'Noodles & snacks', iconKey: 'noodles', sortOrder: 120, enabled: true, businessTypeCodes: ['NOODLE_SNACK'], legacyKeys: ['noodles_snacks'] },
  { code: 'vietnamese_food', nameZh: '特色越餐', nameVi: 'Món Việt', nameEn: 'Vietnamese', iconKey: 'vietnamese', sortOrder: 130, enabled: true, businessTypeCodes: ['VIETNAMESE_FOOD'], legacyKeys: ['vietnamese_food'] },
  { code: 'popular_food', nameZh: '热门美食', nameVi: 'Ẩm thực nổi bật', nameEn: 'Popular dining', iconKey: 'food', sortOrder: 140, enabled: true, businessTypeCodes: [], legacyKeys: ['popular_food'] },
  { code: 'flowers_gifts', nameZh: '鲜花礼品', nameVi: 'Hoa & quà tặng', nameEn: 'Flowers & gifts', iconKey: 'flowers', sortOrder: 310, enabled: true, businessTypeCodes: ['FLOWER_GIFT'], legacyKeys: ['flowers_gifts'] },
  { code: 'fresh_fruit', nameZh: '水果生鲜', nameVi: 'Trái cây tươi', nameEn: 'Fresh fruit', iconKey: 'fruit', sortOrder: 320, enabled: true, businessTypeCodes: ['FRUIT_FRESH'], legacyKeys: ['fresh_fruit'] },
  ...DINING_CATEGORY_DEFINITIONS.map((item, index): ExploreCategory => ({
    code: item.key, nameZh: item.nameZh, nameVi: item.nameVi, nameEn: item.nameEn,
    iconKey: item.iconKey, sortOrder: 150 + index * 10, enabled: true, businessTypeCodes: [], legacyKeys: [item.key],
  })),

];

const RESTAURANT_CODES = new Set(['FOOD_SERVICE', 'CHINESE_RESTAURANT', 'NOODLE_SNACK', 'VIETNAMESE_FOOD', 'COFFEE_TEA', 'RESTAURANT', 'CAKE']);
const SERVICE_CODES = new Set(['MASSAGE_SPA', 'HOTEL', 'KTV', 'HAIR_BEAUTY', 'SPORT_LEISURE']);
const RETAIL_CODES = new Set(['CONVENIENCE_MARKET', 'FLOWER_GIFT', 'FRUIT_FRESH']);

export function merchantContentTemplate(code?: string | null, legacyType?: string) {
  if (code) {
    if (RESTAURANT_CODES.has(code)) return 'RESTAURANT' as const;
    if (SERVICE_CODES.has(code)) return 'SERVICE' as const;
    if (RETAIL_CODES.has(code)) return 'RETAIL' as const;
    return 'GENERAL' as const;
  }
  // Existing restaurants without a business dictionary keep their accepted UI.
  return legacyType === 'RESTAURANT' || legacyType === 'MILK_TEA' || legacyType === 'CAKE'
    ? 'RESTAURANT' as const : 'GENERAL' as const;
}

export function matchesExploreCategory(merchant: { businessType?: { code: string } | null; homepageCategoryKeys?: unknown; manualPopular?: boolean; promotionTags?: Array<{ code: string }>; merchantType?: string }, category: ExploreCategory) {
  if (category.navigationOnly) return true;
  const keys = parseHomepageCategoryKeys(merchant.homepageCategoryKeys);
  const legacyTypeCodes: Record<string, string> = { RESTAURANT: 'FOOD_SERVICE', MILK_TEA: 'COFFEE_TEA', CAKE: 'FOOD_SERVICE', FRUIT: 'FRUIT_FRESH', FLOWER: 'FLOWER_GIFT' };
  const businessCode = merchant.businessType?.code || legacyTypeCodes[merchant.merchantType ?? ''];
  return category.businessTypeCodes.includes(businessCode ?? '')
    || category.legacyKeys.some((key) => key === 'popular_food'
      ? Boolean(keys.includes('popular_food') || merchant.manualPopular || merchant.promotionTags?.some((tag) => tag.code === 'HOT_FOOD'))
      : keys.includes(key as typeof keys[number]));
}

export const EXPLORE_BUSINESS_TYPES = [
  { code: 'MASSAGE_SPA', nameZh: '按摩足疗', nameVi: 'Massage & spa', nameEn: 'Massage & spa' },
  { code: 'HOTEL', nameZh: '酒店住宿', nameVi: 'Khách sạn', nameEn: 'Hotels' },
  { code: 'KTV', nameZh: 'KTV娱乐', nameVi: 'Karaoke', nameEn: 'Karaoke' },
  { code: 'HAIR_BEAUTY', nameZh: '美发美容', nameVi: 'Tóc & làm đẹp', nameEn: 'Hair & beauty' },
  { code: 'SPORT_LEISURE', nameZh: '运动休闲', nameVi: 'Thể thao & giải trí', nameEn: 'Sport & recreation' },
];
