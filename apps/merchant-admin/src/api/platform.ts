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
  PlatformMerchantDetailResponse,
  PlatformMerchantListItem,
  PlatformOrderFilters,
  PlatformOrdersResponse,
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
}) {
  const response = await platformHttp.post<ApiResponse<PlatformMerchantListItem>>(
    '/platform/merchants',
    payload,
  );
  return response.data.data;
}

export async function updatePlatformMerchant(
  id: string,
  payload: {
    nameZh?: string;
    contactPhone?: string;
    homepageCategoryKeys?: string[];
    manualPopular?: boolean;
    isVisibleOnClient?: boolean;
  },
) {
  const response = await platformHttp.patch<ApiResponse<PlatformMerchantListItem>>(
    `/platform/merchants/${id}`,
    payload,
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
