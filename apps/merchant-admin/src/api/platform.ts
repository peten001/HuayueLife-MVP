import axios from 'axios';
import router from '@/router';
import {
  clearPlatformAdmin,
  clearPlatformToken,
  getPlatformToken,
} from '@/utils/storage';
import type {
  ApiResponse,
  PlatformAdminAccount,
  PlatformMerchantListItem,
} from '@/types/api';

const platformHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1',
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

export async function createPlatformMerchant(payload: {
  phone: string;
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
