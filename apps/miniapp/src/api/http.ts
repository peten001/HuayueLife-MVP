import type { ApiResponse } from '@/types/api';
import { clearToken, getToken } from '@/utils/storage';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export async function request<T>(
  path: string,
  options: Omit<UniApp.RequestOptions, 'url'> = {},
): Promise<T> {
  const token = getToken();

  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      url: `${API_BASE_URL}${path}`,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header ?? {}),
      },
      success(response) {
        const body = response.data as ApiResponse<T>;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body.data);
          return;
        }
        if (response.statusCode === 401) clearToken();
        reject(new Error(formatMessage(body?.message)));
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络请求失败'));
      },
    });
  });
}

function formatMessage(message: unknown) {
  if (Array.isArray(message)) return message.join('；');
  return typeof message === 'string' ? message : '请求失败';
}
