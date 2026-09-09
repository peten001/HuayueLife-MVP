import type {
  ApiResponse,
  MerchantReviewPage,
  OwnMerchantReview,
} from '@/types/api';
import { translateApiError, useI18n } from '@/i18n';
import { getToken } from '@/utils/storage';
import { API_BASE_URL, request } from './http';

export interface CreateReviewInput {
  rating: number;
  content?: string;
  isAnonymous: boolean;
  imageTokens: string[];
}

export const createReview = (orderId: string, input: CreateReviewInput) =>
  request<OwnMerchantReview>(`/orders/${orderId}/review`, {
    method: 'POST',
    data: input,
  });

export const getOwnReview = (orderId: string) =>
  request<OwnMerchantReview>(`/orders/${orderId}/review`);

export const getMerchantReviews = (merchantId: string, page = 1) =>
  request<MerchantReviewPage>(`/merchants/${merchantId}/reviews?page=${page}`);

export const createDirectReview = (merchantId: string, input: CreateReviewInput) =>
  request<OwnMerchantReview>(`/merchants/${merchantId}/reviews`, {
    method: 'POST',
    data: input,
  });

export const getOwnDirectReview = (merchantId: string) =>
  request<OwnMerchantReview | null>(`/merchants/${merchantId}/reviews/me`);

export async function uploadReviewImage(orderId: string, filePath: string): Promise<string> {
  return uploadReviewImageTo(`/orders/${orderId}/review-images`, filePath);
}

export async function uploadDirectReviewImage(
  merchantId: string,
  filePath: string,
): Promise<string> {
  return uploadReviewImageTo(`/merchants/${merchantId}/review-images`, filePath);
}

async function uploadReviewImageTo(path: string, filePath: string): Promise<string> {
  const { t } = useI18n();
  const token = getToken();
  if (!token) throw new Error(t('reviewLoginRequired'));

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        try {
          const body = JSON.parse(response.data) as ApiResponse<{ token: string }>;
          if (response.statusCode >= 200 && response.statusCode < 300 && body.data?.token) {
            resolve(body.data.token);
            return;
          }
          const detail = formatUploadError(body.message);
          reject(new Error(detail ? translateApiError(detail) : t('reviewImageUploadFailed')));
        } catch {
          reject(new Error(t('reviewImageUploadFailed')));
        }
      },
      fail() {
        reject(new Error(t('reviewImageUploadNetworkFailed')));
      },
    });
  });
}

function formatUploadError(message: unknown) {
  if (Array.isArray(message)) return message.join('；');
  return typeof message === 'string' && message.trim()
    ? message
    : '';
}
