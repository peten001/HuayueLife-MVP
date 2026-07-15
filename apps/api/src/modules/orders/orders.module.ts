import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PrintersModule } from '../printers/printers.module';
import { PrintingModule } from '../printing/printing.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CartModule, PrintersModule, PrintingModule, TableSessionsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
