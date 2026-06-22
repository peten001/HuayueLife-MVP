import type { ApiResponse } from '@/types/api';
import { translateApiError } from '@/i18n';
import { clearToken, getToken } from '@/utils/storage';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const DEBUG_REQUESTS = true;
let requestSeq = 0;

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function request<T>(
  path: string,
  options: Omit<UniApp.RequestOptions, 'url'> = {},
): Promise<T> {
  const token = getToken();
  const requestId = ++requestSeq;
  const method = String(options.method ?? 'GET').toUpperCase();
  const url = `${API_BASE_URL}${path}`;
  const startTime = Date.now();
  const debugPayload =
    options.data !== undefined ? options.data : options.params ?? null;

  if (DEBUG_REQUESTS) {
    console.log(
      `[miniapp][request:${requestId}] start`,
      method,
      url,
      safeJson(debugPayload),
      startTime,
    );
  }

  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      url,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header ?? {}),
      },
      success(response) {
        const durationMs = Date.now() - startTime;
        const body = response.data as ApiResponse<T>;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (DEBUG_REQUESTS) {
            console.log(
              `[miniapp][request:${requestId}] success`,
              method,
              url,
              response.statusCode,
              durationMs,
            );
          }
          resolve(body.data);
          return;
        }
        if (response.statusCode === 401) clearToken();
        if (DEBUG_REQUESTS) {
          console.warn(
            `[miniapp][request:${requestId}] fail`,
            method,
            url,
            response.statusCode,
            durationMs,
            safeJson(body?.message),
          );
        }
        const error = new Error(formatMessage(body?.message)) as Error & {
          statusCode?: number;
          response?: unknown;
          responseBody?: unknown;
        };
        error.statusCode = response.statusCode;
        error.response = response;
        error.responseBody = body;
        reject(error);
      },
      fail(error) {
        const durationMs = Date.now() - startTime;
        if (DEBUG_REQUESTS) {
          console.warn(
            `[miniapp][request:${requestId}] fail`,
            method,
            url,
            durationMs,
            error.errMsg,
          );
        }
        const requestError = new Error(
          formatMessage(error.errMsg || '网络请求失败'),
        ) as Error & {
          statusCode?: number;
          response?: unknown;
          responseBody?: unknown;
          originalError?: unknown;
        };
        requestError.response = error;
        requestError.originalError = error;
        reject(requestError);
      },
    });
  });
}

function formatMessage(message: unknown) {
  if (Array.isArray(message)) return translateApiError(message.join('；'));
  if (typeof message === 'string') return translateApiError(message);
  return translateApiError('请求失败');
}
