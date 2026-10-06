import type { MerchantSummary } from '@/types/api';

type MerchantServiceBadge = { code: string; labelKey: 'dineIn' | 'pickup' | 'delivery' };

// Public ordering flags already include platform and merchant permission gates.
// Browsing cards show only the three main dining options. Full facilities and
// scan-to-order information remain available on the merchant detail page.
export function merchantServiceBadges(merchant: MerchantSummary, restaurant: boolean): MerchantServiceBadge[] {
  const badges: MerchantServiceBadge[] = [];
  if (restaurant) {
    if (merchant.dineInEnabled === true) badges.push({ code: 'dineInEnabled', labelKey: 'dineIn' });
    if (merchant.pickupEnabled === true) badges.push({ code: 'pickupEnabled', labelKey: 'pickup' });
    if (merchant.deliveryEnabled === true) badges.push({ code: 'deliveryEnabled', labelKey: 'delivery' });
  }
  return badges;
}

// Use merchant-owned product photos to invite browsing, never menu posters or licences.
export function merchantDiscoveryPhotos(merchant: MerchantSummary): string[] {
  const images = (merchant.images || []).filter(item => item.isVisible !== false).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const products = images.filter(item => item.imageType === 'PRODUCT').map(item => item.imageUrl);
  const store = [merchant.coverUrl, ...images.filter(item => ['COVER', 'STORE', 'ENVIRONMENT'].includes(item.imageType)).map(item => item.imageUrl)];
  const photos = [
    ...(merchant.signatureDishes || []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map(item => item.imageUrl),
    ...(merchant.businessType?.code === 'COFFEE_TEA' ? [...store, ...products] : [...products, ...store]),
    merchant.logoUrl,
  ];
  return [...new Set(photos.filter((url): url is string => Boolean(url?.trim())))];
}

export function merchantSpotlights(merchants: MerchantSummary[], failedPhotos: ReadonlySet<string> = new Set()): Array<{ merchant: MerchantSummary; photo: string }> {
  const candidates = merchants.flatMap(merchant => {
    const photo = merchantDiscoveryPhotos(merchant).find(url => !failedPhotos.has(url));
    return photo ? [{ merchant, photo }] : [];
  });
  if (!candidates.length) return [];
  // Lead with a genuine dish/product image when one is available; keep server
  // order among equally suitable stores and mix industries for the second card.
  const first = candidates.find(item => item.merchant.signatureDishes?.length)
    || candidates.find(item => item.merchant.images?.some(image => image.imageType === 'PRODUCT' && image.isVisible !== false))
    || candidates[0];
  const dining = ['FOOD_SERVICE', 'CHINESE_RESTAURANT', 'NOODLE_SNACK', 'VIETNAMESE_FOOD', 'RESTAURANT', 'CAKE'];
  const coffee = dining.includes(first.merchant.businessType?.code || '') ? candidates.find(item => item.merchant.businessType?.code === 'COFFEE_TEA') : undefined;
  const second = coffee || candidates.find(item => item.merchant.id !== first.merchant.id && item.merchant.businessType?.code !== first.merchant.businessType?.code && (item.merchant.signatureDishes?.length || item.merchant.images?.some(image => image.imageType === 'PRODUCT' && image.isVisible !== false)))
    || candidates.find(item => item.merchant.id !== first.merchant.id && item.merchant.businessType?.code !== first.merchant.businessType?.code)
    || candidates.find(item => item.merchant.id !== first.merchant.id);
  return second ? [first, second] : [first];
}
