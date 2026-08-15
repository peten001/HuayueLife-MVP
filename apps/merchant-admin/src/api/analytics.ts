import { http } from './http';
import type { ApiResponse } from '@/types/api';

export interface MerchantAnalyticsFilters {
  dateFrom: string;
  dateTo: string;
}

export interface AnalyticsComparison {
  revenuePercent: number | null;
  orderCountPercent: number | null;
  averageOrderValuePercent: number | null;
}

export interface AnalyticsDish {
  key: string;
  productId: string | null;
  name: string;
  imageUrl: string | null;
  quantity: number;
  revenueVnd: string;
  previousQuantity: number;
  changePercent: number | null;
}

export interface MerchantAnalyticsResponse {
  generatedAt: string;
  currency: string;
  period: {
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
    dayCount: number;
    granularity: 'hour' | 'day';
    timeZone: string;
  };
  overview: {
    revenueVnd: string;
    orderCount: number;
    averageOrderValueVnd: string;
    funds: {
      grossAmountVnd: string;
      discountAmountVnd: string;
      roundingAmountVnd: string;
      netSettledAmountVnd: string;
      cashRevenueVnd: string;
      bankTransferRevenueVnd: string;
      unrecordedRevenueVnd: string;
    };
    previous: {
      revenueVnd: string;
      orderCount: number;
      averageOrderValueVnd: string;
    };
    comparison: AnalyticsComparison;
    topDish: AnalyticsDish | null;
  };
  trend: Array<{
    key: string;
    label: string;
    orderCount: number;
    revenueVnd: string;
  }>;
  timeDistribution: Array<{
    weekday: number;
    startHour: number;
    endHour: number;
    orderCount: number;
    revenueVnd: string;
  }>;
  peakPeriod: {
    startHour: number;
    endHour: number;
    orderCount: number;
    revenueVnd: string;
  } | null;
  topDishes: AnalyticsDish[];
}

export async function getMerchantAnalytics(
  filters: MerchantAnalyticsFilters,
) {
  const response = await http.get<ApiResponse<MerchantAnalyticsResponse>>(
    '/merchant/analytics',
    { params: filters },
  );
  return response.data.data;
}
