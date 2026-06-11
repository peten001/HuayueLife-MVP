import axios from 'axios';
import router from '@/router';
import { useI18n } from '@/i18n';
import { clearToken, getToken } from '@/utils/storage';

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      clearToken();
      await router.push('/login');
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown) {
  const { t } = useI18n();
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (message === 'Invalid credentials') return t('invalidCredentials');
    if (
      message === 'Missing bearer token' ||
      message === 'Invalid or expired token' ||
      message === 'Merchant identity is missing'
    ) {
      return t('sessionExpired');
    }
    if (Array.isArray(message)) return message.join('; ');
    if (message) return message;
    if (error.code === 'ECONNABORTED') return t('requestTimeout');
    if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
      return t('networkError');
    }
    return error.message || t('operationFailed');
  }
  return error instanceof Error ? error.message : t('operationFailed');
}
