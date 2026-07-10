import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { AppConfigService } from '../app-config/app-config.service';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

@Controller('platform/settings')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformSettingsController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  get() {
    return this.appConfig.getPlatformSettings();
  }

  @Patch()
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.appConfig.updatePlatformOrderingEnabled(dto.platformOrderingEnabled);
  }
}
