import type { MerchantSummary } from '@/types/api';

export function resolveContentTemplate(merchant: Pick<MerchantSummary, 'contentTemplate' | 'businessType'> | null) {
  if (merchant?.contentTemplate) return merchant.contentTemplate;
  const code = merchant?.businessType?.code;
  if (['FOOD_SERVICE', 'CHINESE_RESTAURANT', 'NOODLE_SNACK', 'VIETNAMESE_FOOD', 'COFFEE_TEA', 'RESTAURANT', 'CAKE'].includes(code ?? '')) return 'RESTAURANT';
  if (['MASSAGE_SPA', 'HOTEL', 'KTV', 'HAIR_BEAUTY', 'SPORT_LEISURE'].includes(code ?? '')) return 'SERVICE';
  if (['CONVENIENCE_MARKET', 'FLOWER_GIFT', 'FRUIT_FRESH'].includes(code ?? '')) return 'RETAIL';
  return 'GENERAL';
}
