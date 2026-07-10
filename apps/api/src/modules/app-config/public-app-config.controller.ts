import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Controller('public/app-config')
export class PublicAppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  get() {
    return this.appConfig.getPublicConfig();
  }
}
