import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ActiveMerchantStaffGuard } from '../printing/guards/active-merchant-staff.guard';
import { CashierPushService } from './cashier-push.service';
import {
  CashierPushSubscriptionDto,
  RemoveCashierPushSubscriptionDto,
} from './dto/cashier-push-subscription.dto';

@Controller('merchant/cashier-push')
@UseGuards(JwtAuthGuard, ActiveMerchantStaffGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class CashierPushController {
  constructor(private readonly service: CashierPushService) {}

  @Get('public-key')
  publicKey() {
    return this.service.publicConfiguration();
  }

  @Post('subscriptions')
  subscribe(@MerchantId() merchantId: bigint, @CurrentUser() user: AuthUser, @Body() dto: CashierPushSubscriptionDto) {
    return this.service.subscribe(merchantId, BigInt(user.sub), dto);
  }

  @Delete('subscriptions')
  unsubscribe(@MerchantId() merchantId: bigint, @Body() dto: RemoveCashierPushSubscriptionDto) {
    return this.service.unsubscribe(merchantId, dto.endpoint);
  }
}
