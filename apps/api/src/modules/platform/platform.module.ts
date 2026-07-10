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
import { PlatformDictionariesController } from './platform-dictionaries.controller';
import { PlatformDictionariesService } from './platform-dictionaries.service';
import { PlatformUploadsController } from './platform-uploads.controller';
import { PlatformUploadsService } from './platform-uploads.service';
import { PlatformOrdersController } from './platform-orders.controller';
import { PlatformOrdersService } from './platform-orders.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { AppConfigModule } from '../app-config/app-config.module';

@Module({
  imports: [AppConfigModule],
  controllers: [
    PlatformAuthController,
    PlatformDashboardController,
    PlatformAnalyticsController,
    PlatformDictionariesController,
    PlatformUploadsController,
    PlatformMerchantsController,
    PlatformOrdersController,
    PlatformUsersController,
    PlatformSettingsController,
  ],
  providers: [
    JwtAuthGuard,
    PlatformAdminGuard,
    PlatformAuthService,
    PlatformDashboardService,
    PlatformAnalyticsService,
    PlatformDictionariesService,
    PlatformUploadsService,
    PlatformMerchantsService,
    PlatformOrdersService,
    PlatformUsersService,
  ],
})
export class PlatformModule {}
