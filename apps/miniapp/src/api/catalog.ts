import type {
  MenuResponse,
  MerchantDetail,
  MerchantSummary,
  Product,
  QrResolveResponse,
} from '@/types/api';
import { request } from './http';

export function getNearbyMerchants(params: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  page?: number;
  city?: string;
  businessTypeId?: string;
  promotionTag?: string;
}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return request<{
    items: MerchantSummary[];
    page: number;
    pageSize: number;
    total: number;
    locationMode: 'GPS' | 'CITY';
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
