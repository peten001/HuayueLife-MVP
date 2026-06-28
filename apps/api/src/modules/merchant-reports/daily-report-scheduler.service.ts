import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { getVietnamCurrentTime, MerchantReportsService } from './merchant-reports.service';

@Injectable()
export class DailyReportSchedulerService {
  private readonly logger = new Logger(DailyReportSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: MerchantReportsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scanDailyReports() {
    const vietnamNow = getVietnamCurrentTime();
    this.logger.log(`Scanning daily reports at Asia/Ho_Chi_Minh ${vietnamNow.hhmm}`);

    const settings = await this.prisma.merchantReportSetting.findMany({
      where: {
        pushTime: vietnamNow.hhmm,
        merchant: {
          reportFeatureEnabled: true,
        },
      },
      select: {
        merchantId: true,
        enabled: true,
        zaloRecipient: true,
        language: true,
      },
    });

    this.logger.log(`Daily report settings matching push time: ${settings.length}`);

    for (const setting of settings) {
      if (!setting.enabled) {
        this.logger.debug(`Skip merchant ${setting.merchantId.toString()}: daily report disabled`);
        continue;
      }
      if (!setting.zaloRecipient?.trim()) {
        this.logger.warn(`Skip merchant ${setting.merchantId.toString()}: missing Zalo recipient`);
        continue;
      }

      try {
        const result = await this.reportsService.sendDailyReportForMerchant(setting.merchantId, {
          language: setting.language,
          source: 'scheduled',
          skipIfAlreadySent: true,
        });
        if (result.skipped) {
          this.logger.debug(`Skip merchant ${setting.merchantId.toString()}: already sent today`);
          continue;
        }
        this.logger.log(`Daily report mock sent for merchant ${setting.merchantId.toString()}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scheduled report error';
        this.logger.error(
          `Daily report mock failed for merchant ${setting.merchantId.toString()}: ${message}`,
        );
      }
    }
  }
}
