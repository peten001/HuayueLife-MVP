import { Module } from '@nestjs/common';
import { MerchantCapabilitiesService } from './merchant-capabilities.service';

@Module({
  providers: [MerchantCapabilitiesService],
  exports: [MerchantCapabilitiesService],
})
export class MerchantCapabilitiesModule {}
