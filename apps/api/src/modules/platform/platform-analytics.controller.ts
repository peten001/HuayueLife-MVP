import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformAnalyticsQueryDto } from './dto/platform-analytics-query.dto';
import { PlatformAnalyticsService } from './platform-analytics.service';

@Controller('platform/analytics')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAnalyticsController {
  constructor(private readonly service: PlatformAnalyticsService) {}

  @Get()
  getAnalytics(@Query() query: PlatformAnalyticsQueryDto) {
    return this.service.getAnalytics(query);
  }
}
