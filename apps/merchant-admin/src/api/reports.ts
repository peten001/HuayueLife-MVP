import { http } from './http';
import type {
  ApiResponse,
  DailyReportLanguage,
  DailyReportPreviewResponse,
  DailyReportSendResponse,
  MerchantReportFeatureResponse,
  MerchantReportSettings,
} from '@/types/api';

export async function getReportFeature() {
  const response = await http.get<ApiResponse<MerchantReportFeatureResponse>>(
    '/merchant/reports/feature',
  );
  return response.data.data;
}

export async function getReportSettings() {
  const response = await http.get<ApiResponse<MerchantReportSettings>>(
    '/merchant/reports/settings',
  );
  return response.data.data;
}

export async function updateReportSettings(payload: MerchantReportSettings) {
  const response = await http.put<ApiResponse<MerchantReportSettings>>(
    '/merchant/reports/settings',
    payload,
  );
  return response.data.data;
}

export async function previewDailyReport(language?: DailyReportLanguage) {
  const response = await http.get<ApiResponse<DailyReportPreviewResponse>>(
    '/merchant/reports/daily/preview',
    {
      params: language ? { language } : undefined,
    },
  );
  return response.data.data;
}

export async function sendDailyReportMock(language?: DailyReportLanguage) {
  const response = await http.post<ApiResponse<DailyReportSendResponse>>(
    '/merchant/reports/daily/send',
    language ? { language } : {},
  );
  return response.data.data;
}

