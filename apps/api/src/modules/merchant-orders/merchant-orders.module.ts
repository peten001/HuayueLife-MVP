import { Module } from '@nestjs/common';
import { PrintersModule } from '../printers/printers.module';
import { PrintingModule } from '../printing/printing.module';
import { OrdersModule } from '../orders/orders.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantOrdersService } from './merchant-orders.service';
import { MerchantTableOrdersController } from './merchant-table-orders.controller';

@Module({
  imports: [PrintersModule, PrintingModule, OrdersModule, TableSessionsModule],
  controllers: [MerchantOrdersController, MerchantTableOrdersController],
  providers: [MerchantOrdersService],
})
export class MerchantOrdersModule {}
