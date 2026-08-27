import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { TableIdParamDto } from './dto/table-id-param.dto';
import { SettlementAdjustmentDto } from '../orders/settlement-adjustment.dto';
import { PaymentMethodDto } from '../orders/payment-method.dto';
import { TableSessionsService } from './table-sessions.service';
import { TransferTableSessionDto } from './dto/transfer-table-session.dto';

class TableSessionRoundingDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('merchant')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantTableSessionsController {
  constructor(private readonly service: TableSessionsService) {}

  @Get('table-sessions/open')
  listOpenSessions(@MerchantId() merchantId: bigint) {
    return this.service.listOpenSessions(merchantId);
  }

  @Get('tables/:tableId/current-session')
  getCurrentSession(
    @MerchantId() merchantId: bigint,
    @Param() params: TableIdParamDto,
  ) {
    return this.service.getCurrentSession(merchantId, BigInt(params.tableId));
  }

  @Get('table-sessions/:id')
  getSession(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.getSessionDetail(merchantId, BigInt(params.id));
  }

  @Post('table-sessions/:id/close')
  closeSession(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.closeSession(merchantId, BigInt(params.id));
  }

  @Post('table-sessions/:id/checkout')
  checkoutSession(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.checkoutSession(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
    );
  }

  @Post('table-sessions/:id/cashier-checkout')
  cashierCheckoutSession(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: PaymentMethodDto,
  ) {
    return this.service.checkoutSession(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      dto.paymentMethod,
    );
  }

  @Post('table-sessions/:id/rounding')
  setRounding(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() body: TableSessionRoundingDto,
  ) {
    return this.service.setRounding(merchantId, BigInt(staff.sub), BigInt(params.id), body.enabled);
  }

  @Post('table-sessions/:id/settlement-adjustment')
  setSettlementAdjustment(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() body: SettlementAdjustmentDto,
  ) {
    return this.service.setSettlementAdjustment(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      body,
    );
  }

  @Post('table-sessions/:id/transfer')
  transferSession(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() body: TransferTableSessionDto,
  ) {
    return this.service.transferSession(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      {
        targetTableId: BigInt(body.targetTableId),
        expectedSourceTableId: BigInt(body.expectedSourceTableId),
        requestKey: body.requestKey,
      },
    );
  }
}
