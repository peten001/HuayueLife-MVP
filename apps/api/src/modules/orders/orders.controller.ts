import {
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { OrderRequestDto } from './dto/order-request.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

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
}
