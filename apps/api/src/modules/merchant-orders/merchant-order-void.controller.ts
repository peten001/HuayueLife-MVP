import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { StaffRole } from '@prisma/client';
import { MerchantOrderVoidService } from './merchant-order-void.service';
import { ListOrderVoidsDto, VoidOrderDto } from './dto/void-order.dto';

@Controller('merchant/order-voids')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantOrderVoidController {
  constructor(private readonly service: MerchantOrderVoidService) {}

  @Get()
  list(@MerchantId() merchantId: bigint, @CurrentUser() user: AuthUser, @Query() query: ListOrderVoidsDto) {
    return this.service.list(merchantId, BigInt(user.sub), query);
  }

  @Get(':target/preview')
  preview(@MerchantId() merchantId: bigint, @CurrentUser() user: AuthUser, @Param('target') target: string) {
    return this.service.preview(merchantId, BigInt(user.sub), target);
  }

  @Post(':target')
  void(@MerchantId() merchantId: bigint, @CurrentUser() user: AuthUser, @Param('target') target: string, @Body() dto: VoidOrderDto) {
    return this.service.void(merchantId, BigInt(user.sub), target, dto);
  }
}
