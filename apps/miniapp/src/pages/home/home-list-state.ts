import type { MerchantSummary } from '@/types/api';

export type HomeRegionCode = 'Bac Giang' | 'Bac Ninh';
export type HomeMerchantListMode = 'province' | 'nearby';
export type HomeServiceFilter = 'OPEN' | 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type HomeCategoryKey =
  | 'popular_food'
  | 'chinese_dining'
  | 'noodles_snacks'
  | 'coffee_milk_tea'
  | 'flowers_gifts'
  | 'fresh_fruit'
  | 'convenience_store'
  | 'vietnamese_food';

export type HomeMerchantListRequest = {
  regionCode: HomeRegionCode;
  mode: HomeMerchantListMode;
  latitude?: number;
  longitude?: number;
  homepageCategoryKey?: HomeCategoryKey;
  keyword?: string;
  serviceFilters: HomeServiceFilter[];
};

export function merchantQueryForPage(
  request: HomeMerchantListRequest,
  targetPage: number,
) {
  const query: {
    province?: string;
    page: number;
    lat?: number;
    lng?: number;
    homepageCategoryKey?: HomeCategoryKey;
    keyword?: string;
    serviceFilter?: HomeServiceFilter[];
  } = { page: targetPage };
  const keyword = request.keyword?.trim() || undefined;
  if (!keyword) {
    query.province = request.regionCode === 'Bac Ninh' ? '北宁' : '北江';
  }
  if (request.latitude !== undefined && request.longitude !== undefined) {
    query.lat = request.latitude;
    query.lng = request.longitude;
  }
  if (request.homepageCategoryKey) {
    query.homepageCategoryKey = request.homepageCategoryKey;
  }
  if (keyword) {
    query.keyword = keyword;
  }
  if (request.serviceFilters.length) {
    query.serviceFilter = [...request.serviceFilters];
  }
  return query;
}

export function merchantQueryKey(request: HomeMerchantListRequest) {
  return JSON.stringify({
    regionCode: request.regionCode,
    mode: request.mode,
    latitude: request.latitude ?? null,
    longitude: request.longitude ?? null,
    homepageCategoryKey: request.homepageCategoryKey ?? null,
    keyword: request.keyword ?? '',
    serviceFilters: [...request.serviceFilters].sort(),
  });
}

export function mergeMerchantPage(
  current: MerchantSummary[],
  incoming: MerchantSummary[],
) {
  const merged = [...current];
  const indexById = new Map(merged.map((merchant, index) => [merchant.id, index]));
  for (const merchant of incoming) {
    const existingIndex = indexById.get(merchant.id);
    if (existingIndex !== undefined) {
      merged[existingIndex] = merchant;
      continue;
    }
    indexById.set(merchant.id, merged.length);
    merged.push(merchant);
  }
  return merged;
}

export function hasMoreMerchantPages(
  currentPage: number,
  currentPageSize: number,
  total: number,
  paginationExhausted: boolean,
) {
  return !paginationExhausted
    && currentPage > 0
    && currentPageSize > 0
    && currentPage * currentPageSize < total;
}

export function isCurrentMerchantResponse(
  responseSequence: number,
  responseKey: string,
  currentSequence: number,
  currentKey: string,
) {
  return responseSequence === currentSequence && responseKey === currentKey;
}

export function isCurrentLocationIntent(
  manualSequenceAtStart: number,
  currentManualSequence: number,
  locationIntent: number,
  currentLocationIntent: number,
) {
  return manualSequenceAtStart === currentManualSequence
    && locationIntent === currentLocationIntent;
}
