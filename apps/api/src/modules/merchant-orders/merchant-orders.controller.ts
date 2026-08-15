import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { RequestWithContext } from '../../common/types/request.type';
import { ListMerchantOrdersQueryDto } from './dto/list-merchant-orders-query.dto';
import { PrintOrderDto } from './dto/print-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { DecreaseOrderItemDto } from './dto/decrease-order-item.dto';
import { ReturnOrderItemDto } from './dto/return-order-item.dto';
import { OrderItemParamsDto } from './dto/order-item-params.dto';
import { OrderRoundingDto } from './dto/order-rounding.dto';
import { SettlementAdjustmentDto } from '../orders/settlement-adjustment.dto';
import { PaymentMethodDto } from '../orders/payment-method.dto';
import { BusinessDaySummaryQueryDto, PrintBusinessDaySummaryDto } from './dto/business-day-summary.dto';
import { MerchantOrdersService } from './merchant-orders.service';
import { PrintersService } from '../printers/printers.service';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';

@Controller('merchant/orders')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantOrdersController {
  constructor(
    private readonly service: MerchantOrdersService,
    private readonly printersService: PrintersService,
    private readonly printingFlags: PrintingFeatureFlagsService,
  ) {}

  @Get()
  list(
    @MerchantId() merchantId: bigint,
    @Query() query: ListMerchantOrdersQueryDto,
  ) {
    return this.service.list(merchantId, query);
  }

  @Get('summary')
  summary(
    @MerchantId() merchantId: bigint,
    @Query() query: ListMerchantOrdersQueryDto,
  ) {
    return this.service.summary(merchantId, query);
  }

  @Get('business-day-summary')
  businessDaySummary(
    @MerchantId() merchantId: bigint,
    @Query() query: BusinessDaySummaryQueryDto,
  ) {
    return this.service.businessDaySummary(merchantId, query.businessDate);
  }

  @Post('business-day-summary/print')
  printBusinessDaySummary(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: PrintBusinessDaySummaryDto,
  ) {
    return this.service.printBusinessDaySummary(
      merchantId,
      BigInt(staff.sub),
      dto.businessDate,
      dto.requestKey,
      request.requestId,
      dto.printerId ? BigInt(dto.printerId) : undefined,
    );
  }

  @Get(':id')
  get(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.get(merchantId, BigInt(params.id));
  }

  @Post(':id/accept')
  accept(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'ACCEPT',
    );
  }

  @Post(':id/reject')
  reject(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: RejectOrderDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'REJECT',
      dto.reason,
    );
  }

  @Post(':id/start-preparing')
  startPreparing(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'START_PREPARING',
    );
  }

  @Post(':id/ready')
  ready(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'READY',
    );
  }

  @Post(':id/start-delivery')
  startDelivery(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'START_DELIVERY',
    );
  }

  @Post(':id/complete')
  complete(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'COMPLETE',
    );
  }

  @Post(':id/cashier-complete')
  cashierComplete(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: PaymentMethodDto,
  ) {
    return this.service.transition(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      'COMPLETE',
      undefined,
      dto.paymentMethod,
    );
  }

  @Patch(':orderId/items/:itemId/quantity')
  decreaseItem(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: OrderItemParamsDto,
    @Body() dto: DecreaseOrderItemDto,
  ) {
    return this.service.decreaseOrderItem(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.orderId),
      BigInt(params.itemId),
      dto,
    );
  }

  @Post(':orderId/items/:itemId/return')
  returnItem(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: OrderItemParamsDto,
    @Body() dto: ReturnOrderItemDto,
  ) {
    return this.service.returnOrderItem(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.orderId),
      BigInt(params.itemId),
      dto,
    );
  }

  @Post(':id/settle')
  settle(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.settle(merchantId, BigInt(params.id));
  }

  @Post(':id/rounding')
  rounding(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: OrderRoundingDto,
  ) {
    return this.service.setRounding(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      dto.enabled,
    );
  }

  @Post(':id/settlement-adjustment')
  settlementAdjustment(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: SettlementAdjustmentDto,
  ) {
    return this.service.setSettlementAdjustment(
      merchantId,
      BigInt(staff.sub),
      BigInt(params.id),
      dto,
    );
  }

  @Post(':id/print')
  print(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: PrintOrderDto,
  ) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.printersService.reprintOrder(
      merchantId,
      BigInt(params.id),
      dto.printerIds?.map((id) => BigInt(id)),
    );
  }
}
