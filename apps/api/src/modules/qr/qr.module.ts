import { Module } from '@nestjs/common';
import { MerchantCapabilitiesModule } from '../merchant-capabilities/merchant-capabilities.module';
import { QrBridgeController } from './qr-bridge.controller';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  imports: [MerchantCapabilitiesModule],
  controllers: [QrController, QrBridgeController],
  providers: [QrService],
})
export class QrModule {}
