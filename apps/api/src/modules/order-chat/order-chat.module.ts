import { Module } from '@nestjs/common';
import {
  OrderChatMerchantController,
  OrderChatUserController,
  ReservationChatUserController,
} from './order-chat.controller';
import { OrderChatService } from './order-chat.service';

@Module({
  controllers: [OrderChatUserController, ReservationChatUserController, OrderChatMerchantController],
  providers: [OrderChatService],
})
export class OrderChatModule {}
