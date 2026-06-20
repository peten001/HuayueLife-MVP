import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformMerchantsController } from './platform-merchants.controller';
import { PlatformMerchantsService } from './platform-merchants.service';

@Module({
  controllers: [
    PlatformAuthController,
    PlatformDashboardController,
    PlatformMerchantsController,
  ],
  providers: [
    JwtAuthGuard,
    PlatformAdminGuard,
    PlatformAuthService,
    PlatformDashboardService,
    PlatformMerchantsService,
  ],
})
export class PlatformModule {}
