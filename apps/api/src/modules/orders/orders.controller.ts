import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { OrderRequestDto } from './dto/order-request.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(BigInt(user.sub));
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() dto: OrderRequestDto) {
    return this.service.preview(BigInt(user.sub), dto);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: OrderRequestDto,
  ) {
    return this.service.create(BigInt(user.sub), idempotencyKey ?? '', dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.get(BigInt(user.sub), BigInt(params.id));
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.cancel(BigInt(user.sub), BigInt(params.id));
  }

  @Post(':id/confirm-received')
  confirmReceived(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.confirmReceived(BigInt(user.sub), BigInt(params.id));
  }
}
