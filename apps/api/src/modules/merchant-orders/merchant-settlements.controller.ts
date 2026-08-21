import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { ListMerchantSettlementsQueryDto } from './dto/list-merchant-settlements-query.dto';
import { MerchantSettlementsService } from './merchant-settlements.service';

@Controller('merchant/settlements')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantSettlementsController {
  constructor(private readonly service: MerchantSettlementsService) {}

  @Get()
  list(
    @MerchantId() merchantId: bigint,
    @Query() query: ListMerchantSettlementsQueryDto,
  ) {
    return this.service.list(merchantId, query);
  }

  @Get(':settlementId')
  get(
    @MerchantId() merchantId: bigint,
    @Param('settlementId') settlementId: string,
  ) {
    return this.service.get(merchantId, settlementId);
  }
}
