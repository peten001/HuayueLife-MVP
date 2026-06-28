import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { SendDailyReportDto } from './dto/send-daily-report.dto';
import { UpdateReportSettingsDto } from './dto/update-report-settings.dto';
import { MerchantReportsService } from './merchant-reports.service';

@Controller('merchant/reports')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
export class MerchantReportsController {
  constructor(private readonly service: MerchantReportsService) {}

  @Get('feature')
  getFeature(@MerchantId() merchantId: bigint) {
    return this.service.getFeature(merchantId);
  }

  @Get('settings')
  getSettings(@MerchantId() merchantId: bigint) {
    return this.service.getSettings(merchantId);
  }

  @Put('settings')
  updateSettings(
    @MerchantId() merchantId: bigint,
    @Body() dto: UpdateReportSettingsDto,
  ) {
    return this.service.updateSettings(merchantId, dto);
  }

  @Get('daily/preview')
  previewDailyReport(
    @MerchantId() merchantId: bigint,
    @Query('language') language?: string,
  ) {
    return this.service.previewDailyReport(merchantId, language);
  }

  @Post('daily/send')
  sendDailyReport(
    @MerchantId() merchantId: bigint,
    @Body() dto: SendDailyReportDto,
  ) {
    return this.service.sendDailyReport(merchantId, dto);
  }

  @Get('daily/logs')
  listDailyReportLogs(
    @MerchantId() merchantId: bigint,
    @Query('limit') limit?: string,
  ) {
    return this.service.listDailyReportLogs(merchantId, limit);
  }
}
