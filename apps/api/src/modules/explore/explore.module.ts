import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ExploreService } from './explore.service';
import { PublicExploreController, PlatformExploreController } from './explore.controller';

@Module({ controllers: [PublicExploreController, PlatformExploreController], providers: [ExploreService, JwtAuthGuard, PlatformAdminGuard], exports: [ExploreService] })
export class ExploreModule {}
