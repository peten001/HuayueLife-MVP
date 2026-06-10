import { Module } from '@nestjs/common';
import { MerchantProfileController } from './merchant-profile.controller';
import { MerchantProfileService } from './merchant-profile.service';

@Module({
  controllers: [MerchantProfileController],
  providers: [MerchantProfileService],
})
export class MerchantProfileModule {}
