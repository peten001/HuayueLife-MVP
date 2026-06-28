import { Injectable } from '@nestjs/common';
import type { DailyReportLanguage } from './merchant-reports.constants';

export interface DailyReportSendPayload {
  recipient: string;
  language: DailyReportLanguage;
  imageUrl: string;
  summary: Record<string, unknown>;
}

@Injectable()
export class ZaloReportSender {
  async sendDailyReport(_payload: DailyReportSendPayload) {
    // TODO: Replace mock sender with Zalo OA API integration.
    return {
      success: true as const,
      mocked: true as const,
    };
  }
}

