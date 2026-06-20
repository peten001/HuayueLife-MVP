import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformAnalyticsController } from './platform-analytics.controller';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformMerchantsController } from './platform-merchants.controller';
import { PlatformMerchantsService } from './platform-merchants.service';
import { PlatformOrdersController } from './platform-orders.controller';
import { PlatformOrdersService } from './platform-orders.service';

@Module({
  controllers: [
    PlatformAuthController,
    PlatformDashboardController,
    PlatformAnalyticsController,
    PlatformMerchantsController,
    PlatformOrdersController,
  ],
  providers: [
    JwtAuthGuard,
    PlatformAdminGuard,
    PlatformAuthService,
    PlatformDashboardService,
    PlatformAnalyticsService,
    PlatformMerchantsService,
    PlatformOrdersService,
  ],
})
export class PlatformModule {}
