import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { PublicAppConfigController } from './public-app-config.controller';

@Global()
@Module({
  controllers: [PublicAppConfigController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
