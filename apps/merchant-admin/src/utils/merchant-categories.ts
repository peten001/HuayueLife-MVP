export const MERCHANT_CATEGORY_OPTIONS = [
  { value: 'popular_food', nameZh: '热门美食', nameVi: 'Ẩm thực nổi bật', nameEn: 'Popular dining' },
  { value: 'chinese_dining', nameZh: '中式正餐', nameVi: 'Món Trung', nameEn: 'Chinese dining' },
  { value: 'noodles_snacks', nameZh: '粉面小吃', nameVi: 'Mì & ăn vặt', nameEn: 'Noodles & snacks' },
  { value: 'coffee_milk_tea', nameZh: '咖啡奶茶', nameVi: 'Cà phê & trà sữa', nameEn: 'Coffee & milk tea' },
  { value: 'flowers_gifts', nameZh: '鲜花礼品', nameVi: 'Hoa & quà tặng', nameEn: 'Flowers & gifts' },
  { value: 'fresh_fruit', nameZh: '水果生鲜', nameVi: 'Trái cây tươi', nameEn: 'Fresh fruit' },
  { value: 'convenience_store', nameZh: '便利超市', nameVi: 'Siêu thị tiện lợi', nameEn: 'Convenience stores' },
  { value: 'vietnamese_food', nameZh: '特色越餐', nameVi: 'Món Việt', nameEn: 'Vietnamese' },
  { value: 'japanese_food', nameZh: '日本料理', nameVi: 'Món Nhật', nameEn: 'Japanese' },
  { value: 'thai_food', nameZh: '泰国菜', nameVi: 'Món Thái', nameEn: 'Thai' },
  { value: 'seafood', nameZh: '海鲜', nameVi: 'Hải sản', nameEn: 'Seafood' },
  { value: 'korean_food', nameZh: '韩国料理', nameVi: 'Món Hàn', nameEn: 'Korean' },
  { value: 'hotpot', nameZh: '火锅', nameVi: 'Lẩu', nameEn: 'Hotpot' },
  { value: 'barbecue', nameZh: '烧烤', nameVi: 'Đồ nướng', nameEn: 'Barbecue' },
  { value: 'bakery_desserts', nameZh: '面包甜品', nameVi: 'Bánh & đồ ngọt', nameEn: 'Bakery & desserts' },
  { value: 'sichuan_hunan', nameZh: '川湘菜', nameVi: 'Tứ Xuyên & Hồ Nam', nameEn: 'Sichuan & Hunan' },
] as const;

export type MerchantCategoryKey = typeof MERCHANT_CATEGORY_OPTIONS[number]['value'];

export function merchantCategoryOptions(locale: string = 'zh') {
  return MERCHANT_CATEGORY_OPTIONS.map(item => ({
    value: item.value, label: locale === 'vi' ? item.nameVi : locale === 'en' ? item.nameEn : item.nameZh,
  }));
}
