import type {
  MenuResponse,
  ExploreCategory,
  ExploreTopic,
  AppConfig,
  MerchantDetail,
  MerchantSummary,
  HomeRecommendations,
  Product,
  QrResolveResponse,
} from '@/types/api';
import { request } from './http';

export const getExploreContent = () => request<{ categories: ExploreCategory[]; topics: ExploreTopic[] }>('/public/explore');

export function getHomeRecommendations(params: { province: '北江' | '北宁'; lat?: number; lng?: number }) {
  const query = Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');
  return request<HomeRecommendations>(`/public/home-recommendations?${query}`);
}

export const getAppConfig = () => request<AppConfig>('/public/app-config');

export function getNearbyMerchants(params: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  page?: number;
  city?: string;
  province?: string;
  businessTypeId?: string;
  exploreCategory?: string;
  exploreTopic?: string;
  promotionTag?: string;
  homepageCategoryKey?: string;
  keyword?: string;
  serviceFilter?: Array<'OPEN' | 'DINE_IN' | 'PICKUP' | 'DELIVERY'>;
}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => {
      const normalizedValue = Array.isArray(value) ? value.join(',') : String(value);
      return `${key}=${encodeURIComponent(normalizedValue)}`;
    })
    .join('&');
  return request<{
    items: MerchantSummary[];
    page: number;
    pageSize: number;
    total: number;
    locationMode: 'GPS' | 'CITY' | 'REGION_REQUIRED';
  }>(`/merchants/nearby?${query}`);
}

export const getMerchant = (id: string) =>
  request<MerchantDetail>(`/merchants/${id}`);

export const getMenu = (
  merchantId: string,
  params?: { tableToken?: string },
) => {
  const query = params?.tableToken?.trim()
    ? `?tableToken=${encodeURIComponent(params.tableToken.trim())}`
    : '';
  return request<MenuResponse>(`/merchants/${merchantId}/menu${query}`);
};

export const getProduct = (id: string, params?: { tableToken?: string }) => {
  const query = params?.tableToken?.trim()
    ? `?tableToken=${encodeURIComponent(params.tableToken.trim())}`
    : '';
  return request<Product>(`/products/${id}${query}`);
};

export const resolveQr = (params: {
  token?: string;
  scene?: string;
  q?: string;
}) => {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return request<QrResolveResponse>(`/qr/resolve?${query}`);
};
