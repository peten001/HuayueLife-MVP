import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { ProductsService } from './products.service';

@Controller('merchant/products')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  list(
    @MerchantId() merchantId: bigint,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.service.list(merchantId, query);
  }

  @Post()
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  create(@MerchantId() merchantId: bigint, @Body() dto: CreateProductDto) {
    return this.service.create(merchantId, dto);
  }

  @Get(':id')
  get(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.get(merchantId, BigInt(params.id));
  }

  @Patch(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Patch(':id/status')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updateStatus(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductStatusDto,
  ) {
    return this.service.updateStatus(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disable(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.disable(merchantId, BigInt(params.id));
  }
}
