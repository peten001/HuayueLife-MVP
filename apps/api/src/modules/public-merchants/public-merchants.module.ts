import { Module } from '@nestjs/common';
import { MerchantCapabilitiesModule } from '../merchant-capabilities/merchant-capabilities.module';
import { PublicMerchantsController } from './public-merchants.controller';
import { PublicMerchantsService } from './public-merchants.service';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [MerchantCapabilitiesModule, ReviewsModule],
  controllers: [PublicMerchantsController],
  providers: [PublicMerchantsService],
})
export class PublicMerchantsModule {}
