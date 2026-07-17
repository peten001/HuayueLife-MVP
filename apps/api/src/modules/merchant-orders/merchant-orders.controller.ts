import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { ListMerchantOrdersQueryDto } from './dto/list-merchant-orders-query.dto';
import { PrintOrderDto } from './dto/print-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { DecreaseOrderItemDto } from './dto/decrease-order-item.dto';
import { ReturnOrderItemDto } from './dto/return-order-item.dto';
import { OrderItemParamsDto } from './dto/order-item-params.dto';
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
