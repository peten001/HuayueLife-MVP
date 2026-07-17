import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PrintersModule } from '../printers/printers.module';
import { PrintingModule } from '../printing/printing.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderCreatorInvariantService } from './order-creator-invariant.service';
import { PendingOrderCancellationService } from './pending-order-cancellation.service';

@Module({
  imports: [CartModule, PrintersModule, PrintingModule, TableSessionsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderCreatorInvariantService,
    PendingOrderCancellationService,
  ],
  exports: [OrderCreatorInvariantService, PendingOrderCancellationService],
})
export class OrdersModule {}
