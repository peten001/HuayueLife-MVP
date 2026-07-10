import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AppConfigService } from './app-config.service';
import { PublicAppConfigController } from './public-app-config.controller';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [PublicAppConfigController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
