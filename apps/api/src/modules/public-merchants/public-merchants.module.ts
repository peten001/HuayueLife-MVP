import { Module } from '@nestjs/common';
import { PublicMerchantsController } from './public-merchants.controller';
import { PublicMerchantsService } from './public-merchants.service';

@Module({
  controllers: [PublicMerchantsController],
  providers: [PublicMerchantsService],
})
export class PublicMerchantsModule {}
