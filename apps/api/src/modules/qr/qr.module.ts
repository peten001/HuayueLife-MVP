import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantCapabilitiesModule } from '../merchant-capabilities/merchant-capabilities.module';
import { QrBridgeController } from './qr-bridge.controller';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { WechatMiniProgramLaunchService } from './wechat-mini-program-launch.service';

@Module({
  imports: [AuthModule, MerchantCapabilitiesModule],
  controllers: [QrController, QrBridgeController],
  providers: [QrService, WechatMiniProgramLaunchService],
})
export class QrModule {}
