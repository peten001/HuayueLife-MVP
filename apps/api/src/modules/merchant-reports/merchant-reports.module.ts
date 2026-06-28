import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { DailyReportImageService } from './daily-report-image.service';
import { DailyReportSchedulerService } from './daily-report-scheduler.service';
import { MerchantReportsController } from './merchant-reports.controller';
import { MerchantReportsService } from './merchant-reports.service';
import { ZaloReportSender } from './zalo-report.sender';

@Module({
  controllers: [MerchantReportsController],
  providers: [
    JwtAuthGuard,
    MerchantRoleGuard,
    DailyReportImageService,
    DailyReportSchedulerService,
    MerchantReportsService,
    ZaloReportSender,
  ],
})
export class MerchantReportsModule {}
