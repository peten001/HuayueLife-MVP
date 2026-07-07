import { Module } from '@nestjs/common';
import { MerchantCapabilitiesModule } from '../merchant-capabilities/merchant-capabilities.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [MerchantCapabilitiesModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
