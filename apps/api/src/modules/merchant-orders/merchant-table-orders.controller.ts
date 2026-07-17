import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreateTableOrderDto } from './dto/create-table-order.dto';
import { MerchantTableOrderParamsDto } from './dto/merchant-table-order-params.dto';
import { MerchantOrdersService } from './merchant-orders.service';

@Controller('merchant/tables')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantTableOrdersController {
  constructor(private readonly service: MerchantOrdersService) {}

  @Post(':tableId/orders')
  createTableOrder(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: MerchantTableOrderParamsDto,
    @Body() dto: CreateTableOrderDto,
  ) {
    return this.service.createTableOrder(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.tableId),
      dto,
    );
  }
}
