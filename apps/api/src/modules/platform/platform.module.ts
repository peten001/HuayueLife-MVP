import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformMerchantsController } from './platform-merchants.controller';
import { PlatformMerchantsService } from './platform-merchants.service';

@Module({
  controllers: [PlatformAuthController, PlatformMerchantsController],
  providers: [
    JwtAuthGuard,
    PlatformAdminGuard,
    PlatformAuthService,
    PlatformMerchantsService,
  ],
})
export class PlatformModule {}
