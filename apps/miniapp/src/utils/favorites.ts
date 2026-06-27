import type { MerchantSummary } from '@/types/api';

const FAVORITES_KEY = 'huayue_favorites';

export interface FavoriteMerchant {
  id: string;
  nameZh: string;
  nameVi?: string;
  coverUrl?: string;
  addressDetail?: string;
  distanceKm?: number | null;
  homepageCategoryKeys?: string[];
  manualPopular?: boolean;
  isOpen?: boolean;
  supportedOrderTypes?: MerchantSummary['supportedOrderTypes'];
  savedAt: string;
}

function readFavorites(): FavoriteMerchant[] {
  return (uni.getStorageSync(FAVORITES_KEY) || []) as FavoriteMerchant[];
}

function writeFavorites(favorites: FavoriteMerchant[]) {
  uni.setStorageSync(FAVORITES_KEY, favorites);
}

export function getFavorites() {
  return readFavorites();
}

export function isFavorite(id: string) {
  return readFavorites().some((item) => item.id === id);
}

export function addFavorite(merchant: MerchantSummary) {
  const favorites = readFavorites();
  if (favorites.some((item) => item.id === merchant.id)) return favorites;
  const next: FavoriteMerchant = {
    id: merchant.id,
    nameZh: merchant.nameZh,
    nameVi: merchant.nameVi,
    coverUrl: merchant.coverUrl,
    addressDetail: merchant.addressDetail,
    distanceKm: merchant.distanceKm,
    homepageCategoryKeys: merchant.homepageCategoryKeys ?? [],
    manualPopular: merchant.manualPopular,
    isOpen: merchant.isOpen,
    supportedOrderTypes: merchant.supportedOrderTypes,
    savedAt: new Date().toISOString(),
  };
  const nextList = [next, ...favorites];
  writeFavorites(nextList);
  return nextList;
}

export function removeFavorite(id: string) {
  const nextList = readFavorites().filter((item) => item.id !== id);
  writeFavorites(nextList);
  return nextList;
}

export function toggleFavorite(merchant: MerchantSummary) {
  const favorites = readFavorites();
  if (favorites.some((item) => item.id === merchant.id)) {
    const nextList = favorites.filter((item) => item.id !== merchant.id);
    writeFavorites(nextList);
    return { favorites: nextList, saved: false };
  }
  const nextList = [
    {
      id: merchant.id,
      nameZh: merchant.nameZh,
      nameVi: merchant.nameVi,
      coverUrl: merchant.coverUrl,
      addressDetail: merchant.addressDetail,
      distanceKm: merchant.distanceKm,
      homepageCategoryKeys: merchant.homepageCategoryKeys ?? [],
      manualPopular: merchant.manualPopular,
      isOpen: merchant.isOpen,
      supportedOrderTypes: merchant.supportedOrderTypes,
      savedAt: new Date().toISOString(),
    },
    ...favorites,
  ];
  writeFavorites(nextList);
  return { favorites: nextList, saved: true };
}
