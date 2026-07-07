import { Module } from '@nestjs/common';
import { MerchantCapabilitiesModule } from '../merchant-capabilities/merchant-capabilities.module';
import { PublicMerchantsController } from './public-merchants.controller';
import { PublicMerchantsService } from './public-merchants.service';

@Module({
  imports: [MerchantCapabilitiesModule],
  controllers: [PublicMerchantsController],
  providers: [PublicMerchantsService],
})
export class PublicMerchantsModule {}
