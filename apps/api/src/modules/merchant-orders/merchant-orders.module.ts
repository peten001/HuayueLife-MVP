import { Module } from '@nestjs/common';
import { MerchantOrderVoidController } from './merchant-order-void.controller';
import { MerchantOrderVoidService } from './merchant-order-void.service';
import { PrintersModule } from '../printers/printers.module';
import { PrintingModule } from '../printing/printing.module';
import { OrdersModule } from '../orders/orders.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantOrdersService } from './merchant-orders.service';
import { MerchantAnalyticsController } from './merchant-analytics.controller';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { MerchantTableOrdersController } from './merchant-table-orders.controller';
import { MerchantSettlementsController } from './merchant-settlements.controller';
import { MerchantSettlementsService } from './merchant-settlements.service';
import { MerchantDineInCanonicalController } from './merchant-dine-in-canonical.controller';

@Module({
  imports: [PrintersModule, PrintingModule, OrdersModule, TableSessionsModule],
  controllers: [
    MerchantOrderVoidController,
    MerchantOrdersController,
    MerchantTableOrdersController,
    MerchantAnalyticsController,
    MerchantSettlementsController,
    MerchantDineInCanonicalController,
  ],
  providers: [
    MerchantOrderVoidService,
    MerchantOrdersService,
    MerchantAnalyticsService,
    MerchantSettlementsService,
  ],
})
export class MerchantOrdersModule {}
