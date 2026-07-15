import { Module } from '@nestjs/common';
import { PrintersModule } from '../printers/printers.module';
import { PrintingModule } from '../printing/printing.module';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantOrdersService } from './merchant-orders.service';

@Module({
  imports: [PrintersModule, PrintingModule],
  controllers: [MerchantOrdersController],
  providers: [MerchantOrdersService],
})
export class MerchantOrdersModule {}
