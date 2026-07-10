import axios from 'axios';
import router from '@/router';
import {
  clearPlatformAdmin,
  clearPlatformToken,
  getPlatformToken,
} from '@/utils/storage';
import type {
  ApiResponse,
  PlatformAnalyticsFilters,
  PlatformAnalyticsResponse,
  PlatformDashboardData,
  PlatformAdminAccount,
  PlatformBusinessType,
  PlatformBusinessHours,
  PlatformCapability,
  PlatformMerchantImage,
  PlatformMerchantImageUploadResult,
  PlatformMerchantImportConfirmResponse,
  PlatformMerchantImportPreviewResponse,
  PlatformMerchantImportRow,
  PlatformMerchantDetailResponse,
  PlatformMerchantListItem,
  PlatformOrderFilters,
  PlatformOrdersResponse,
  PlatformPromotionTag,
  PlatformSettings,
  PlatformUserDetailResponse,
  PlatformUserListItem,
  PlatformUsersFilters,
  PlatformUsersResponse,
} from '@/types/api';

const DEFAULT_API_BASE_URL = import.meta.env.PROD
  ? 'https://api.huayueyouxuan.com/api/v1'
  : 'http://localhost:3001/api/v1';

const platformHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  timeout: 15000,
});

platformHttp.interceptors.request.use((config) => {
  const token = getPlatformToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

platformHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      clearPlatformToken();
      clearPlatformAdmin();
      await router.push('/platform/login');
    }
    return Promise.reject(error);
  },
);

export async function loginPlatform(username: string, password: string) {
  const response = await platformHttp.post<
    ApiResponse<{
      accessToken: string;
      admin: PlatformAdminAccount;
    }>
  >('/platform/auth/login', { username, password });
  return response.data.data;
}

export async function getPlatformMerchants() {
  const response = await platformHttp.get<ApiResponse<{
    items: PlatformMerchantListItem[];
  }>>('/platform/merchants');
  return response.data.data.items;
}

export async function getPlatformBusinessTypes() {
  const response = await platformHttp.get<ApiResponse<{ items: PlatformBusinessType[] }>>(
    '/platform/merchant-types',
  );
  return response.data.data.items;
}

export async function createPlatformBusinessType(payload: Partial<PlatformBusinessType>) {
  const response = await platformHttp.post<ApiResponse<PlatformBusinessType>>(
    '/platform/merchant-types',
    payload,
  );
  return response.data.data;
}

export async function updatePlatformBusinessType(
  id: string,
  payload: Partial<PlatformBusinessType>,
) {
  const response = await platformHttp.patch<ApiResponse<PlatformBusinessType>>(
    `/platform/merchant-types/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disablePlatformBusinessType(id: string) {
  const response = await platformHttp.delete<ApiResponse<PlatformBusinessType>>(
    `/platform/merchant-types/${id}`,
  );
  return response.data.data;
}

export async function getPlatformPromotionTags() {
  const response = await platformHttp.get<ApiResponse<{ items: PlatformPromotionTag[] }>>(
    '/platform/promotion-tags',
  );
  return response.data.data.items;
}

export async function createPlatformPromotionTag(payload: Partial<PlatformPromotionTag>) {
  const response = await platformHttp.post<ApiResponse<PlatformPromotionTag>>(
    '/platform/promotion-tags',
    payload,
  );
  return response.data.data;
}

export async function updatePlatformPromotionTag(
  id: string,
  payload: Partial<PlatformPromotionTag>,
) {
  const response = await platformHttp.patch<ApiResponse<PlatformPromotionTag>>(
    `/platform/promotion-tags/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disablePlatformPromotionTag(id: string) {
  const response = await platformHttp.delete<ApiResponse<PlatformPromotionTag>>(
    `/platform/promotion-tags/${id}`,
  );
  return response.data.data;
}

export async function getPlatformCapabilities() {
  const response = await platformHttp.get<ApiResponse<{ items: PlatformCapability[] }>>(
    '/platform/capabilities',
  );
  return response.data.data.items;
}

export async function getPlatformSettings() {
  const response = await platformHttp.get<ApiResponse<PlatformSettings>>(
    '/platform/settings',
  );
  return response.data.data;
}

export async function updatePlatformSettings(payload: Pick<PlatformSettings, 'platformOrderingEnabled'>) {
  const response = await platformHttp.patch<ApiResponse<PlatformSettings>>(
    '/platform/settings',
    payload,
  );
  return response.data.data;
}

export async function getPlatformMerchantDetail(id: string) {
  const response = await platformHttp.get<ApiResponse<PlatformMerchantDetailResponse>>(
    `/platform/merchants/${id}/detail`,
  );
  return response.data.data;
}

export async function getPlatformDashboard() {
  const response = await platformHttp.get<ApiResponse<PlatformDashboardData>>(
    '/platform/dashboard',
  );
  return response.data.data;
}

export async function getPlatformAnalytics(filters: PlatformAnalyticsFilters = {}) {
  const response = await platformHttp.get<ApiResponse<PlatformAnalyticsResponse>>(
    '/platform/analytics',
    {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined),
      ),
    },
  );
  return response.data.data;
}

export async function getPlatformOrders(filters: PlatformOrderFilters = {}) {
  const response = await platformHttp.get<ApiResponse<PlatformOrdersResponse>>(
    '/platform/orders',
    {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined),
      ),
    },
  );
  return response.data.data;
}

export async function getPlatformUsers(filters: PlatformUsersFilters = {}) {
  const response = await platformHttp.get<ApiResponse<PlatformUsersResponse>>(
    '/platform/users',
    {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined),
      ),
    },
  );
  return response.data.data;
}

export async function getPlatformUserDetail(id: string) {
  const response = await platformHttp.get<ApiResponse<PlatformUserDetailResponse>>(
    `/platform/users/${id}/detail`,
  );
  return response.data.data;
}

export async function createPlatformMerchant(payload: {
  phone: string;
  homepageCategoryKeys?: string[];
  manualPopular?: boolean;
  isVisibleOnClient?: boolean;
  reportFeatureEnabled?: boolean;
}) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    '/platform/merchants',
    payload,
  );
  return response.data.data;
}

export async function createPlatformDisplayMerchant(payload: Record<string, unknown>) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    '/platform/merchants/display',
    payload,
  );
  return response.data.data;
}

export async function updatePlatformMerchant(
  id: string,
  payload: {
    nameZh?: string;
    nameVi?: string | null;
    nameEn?: string | null;
    businessTypeId?: string | null;
    merchantMode?: string;
    contactPhone?: string;
    contactName?: string;
    province?: string;
    city?: string;
    district?: string;
    addressZh?: string;
    addressVi?: string;
    addressEn?: string;
    latitude?: number;
    longitude?: number;
    openingHoursText?: string;
    descriptionZh?: string;
    descriptionVi?: string;
    descriptionEn?: string;
    logoUrl?: string;
    coverUrl?: string;
    homepageCategoryKeys?: string[];
    manualPopular?: boolean;
    isVisibleOnClient?: boolean;
    reportFeatureEnabled?: boolean;
    isNew?: boolean;
    sortOrder?: number;
    status?: string;
  },
) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}`,
    payload,
  );
  return response.data.data;
}

export async function updatePlatformMerchantCapabilities(
  id: string,
  items: Array<{ code: string; isEnabled: boolean }>,
) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/capabilities`,
    { items },
  );
  return response.data.data;
}

export async function updatePlatformMerchantTags(id: string, promotionTagIds: string[]) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/tags`,
    { promotionTagIds },
  );
  return response.data.data;
}

export async function openPlatformMerchantAccount(id: string) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/open-account`,
  );
  return response.data.data;
}

export async function updatePlatformMerchantAccountPhone(id: string, phone: string) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/account-phone`,
    { phone },
  );
  return response.data.data;
}

export async function updatePlatformMerchantBusinessHours(
  id: string,
  businessHours: PlatformBusinessHours,
) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantDetailResponse>>(
    `/platform/merchants/${id}/business-hours`,
    { businessHours },
  );
  return response.data.data;
}

export async function getPlatformMerchantImages(id: string) {
  const response = await platformHttp.get<ApiResponse<{ items: PlatformMerchantImage[] }>>(
    `/platform/merchants/${id}/images`,
  );
  return response.data.data.items;
}

export async function uploadPlatformMerchantImage(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await platformHttp.post<ApiResponse<PlatformMerchantImageUploadResult>>(
    '/platform/uploads/merchant-image',
    formData,
  );
  return response.data.data;
}

export async function downloadPlatformMerchantImportTemplate() {
  const response = await platformHttp.get('/platform/merchants/import-template', {
    responseType: 'blob',
  });
  return response.data as Blob;
}

export async function previewPlatformMerchantImport(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await platformHttp.post<ApiResponse<PlatformMerchantImportPreviewResponse>>(
    '/platform/merchants/import-preview',
    formData,
  );
  return response.data.data;
}

export async function confirmPlatformMerchantImport(
  sessionId: string,
  rowNumbers?: number[],
) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantImportConfirmResponse>>(
    '/platform/merchants/import-confirm',
    { sessionId, rowNumbers },
  );
  return response.data.data;
}

export async function createPlatformMerchantImage(
  id: string,
  payload: Partial<PlatformMerchantImage>,
) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantImage>>(
    `/platform/merchants/${id}/images`,
    payload,
  );
  return response.data.data;
}

export async function updatePlatformMerchantImage(
  id: string,
  imageId: string,
  payload: Partial<PlatformMerchantImage>,
) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantImage>>(
    `/platform/merchants/${id}/images/${imageId}`,
    payload,
  );
  return response.data.data;
}

export async function hidePlatformMerchantImage(id: string, imageId: string) {
  const response = await platformHttp.delete<ApiResponse<PlatformMerchantImage>>(
    `/platform/merchants/${id}/images/${imageId}`,
  );
  return response.data.data;
}

export async function disablePlatformMerchant(id: string) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/disable`,
  );
  return response.data.data;
}

export async function enablePlatformMerchant(id: string) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/enable`,
  );
  return response.data.data;
}

export async function resetPlatformMerchantPassword(id: string) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}/reset-password`,
  );
  return response.data.data;
}

export async function deletePlatformMerchant(id: string) {
  const response = await platformHttp.delete<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}`,
  );
  return response.data.data;
}
