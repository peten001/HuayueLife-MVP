import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ListMerchantChatConversationsQueryDto } from './dto/list-merchant-chat-conversations-query.dto';
import { ListOrderChatMessagesQueryDto } from './dto/list-order-chat-messages-query.dto';
import { SendOrderChatMessageDto } from './dto/send-order-chat-message.dto';
import { OrderChatService } from './order-chat.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class OrderChatUserController {
  constructor(private readonly service: OrderChatService) {}

  @Get(':id/chat')
  getConversation(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.getCustomerConversation(BigInt(user.sub), BigInt(params.id));
  }

  @Get(':id/chat/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @Query() query: ListOrderChatMessagesQueryDto,
  ) {
    return this.service.listCustomerMessages(
      BigInt(user.sub),
      BigInt(params.id),
      query,
    );
  }

  @Post(':id/chat/messages')
  sendMessage(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: SendOrderChatMessageDto,
  ) {
    return this.service.sendCustomerMessage(
      BigInt(user.sub),
      BigInt(params.id),
      dto,
    );
  }

  @Post(':id/chat/read')
  markRead(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.markCustomerRead(BigInt(user.sub), BigInt(params.id));
  }
}

@Controller('merchant')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class OrderChatMerchantController {
  constructor(private readonly service: OrderChatService) {}

  @Get('chat/conversations')
  listConversations(
    @MerchantId() merchantId: bigint,
    @Query() query: ListMerchantChatConversationsQueryDto,
  ) {
    return this.service.listMerchantConversations(merchantId, query);
  }

  @Get('orders/:id/chat')
  getConversation(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.getMerchantConversation(merchantId, BigInt(params.id));
  }

  @Get('orders/:id/chat/messages')
  listMessages(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Query() query: ListOrderChatMessagesQueryDto,
  ) {
    return this.service.listMerchantMessages(merchantId, BigInt(params.id), query);
  }

  @Post('orders/:id/chat/messages')
  sendMessage(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: SendOrderChatMessageDto,
  ) {
    return this.service.sendMerchantMessage(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      dto,
    );
  }

  @Post('orders/:id/chat/read')
  markRead(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.markMerchantRead(merchantId, BigInt(params.id));
  }
}
