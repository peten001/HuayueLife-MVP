import { Module } from '@nestjs/common';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantOrdersService } from './merchant-orders.service';

@Module({
  controllers: [MerchantOrdersController],
  providers: [MerchantOrdersService],
})
export class MerchantOrdersModule {}
