import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ReconcileDineInCanonicalStateDto } from '../table-sessions/dto/dine-in-canonical-state.dto';
import { MerchantOrdersService } from './merchant-orders.service';

@Controller('merchant/table-sessions')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantDineInCanonicalController {
  constructor(private readonly service: MerchantOrdersService) {}

  @Post(':id/canonical-state/reconcile')
  reconcile(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: ReconcileDineInCanonicalStateDto,
  ) {
    return this.service.reconcileDineInCanonicalState(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      dto,
    );
  }
}
