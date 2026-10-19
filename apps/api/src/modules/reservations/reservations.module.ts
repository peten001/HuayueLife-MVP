import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CashierPushModule } from '../cashier-push/cashier-push.module';
import { OrdersModule } from '../orders/orders.module';
import { MerchantOrdersModule } from '../merchant-orders/merchant-orders.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { ReservationsController, MerchantReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [CartModule, CashierPushModule, OrdersModule, MerchantOrdersModule, TableSessionsModule],
  controllers: [ReservationsController, MerchantReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
