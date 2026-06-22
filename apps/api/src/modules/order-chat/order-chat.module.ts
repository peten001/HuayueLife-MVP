import { Module } from '@nestjs/common';
import {
  OrderChatMerchantController,
  OrderChatUserController,
} from './order-chat.controller';
import { OrderChatService } from './order-chat.service';

@Module({
  controllers: [OrderChatUserController, OrderChatMerchantController],
  providers: [OrderChatService],
})
export class OrderChatModule {}
