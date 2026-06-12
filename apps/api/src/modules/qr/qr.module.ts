import { Module } from '@nestjs/common';
import { QrBridgeController } from './qr-bridge.controller';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  controllers: [QrController, QrBridgeController],
  providers: [QrService],
})
export class QrModule {}
