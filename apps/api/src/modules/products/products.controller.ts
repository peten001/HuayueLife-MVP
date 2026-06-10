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
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { MerchantStaffGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { ProductsService } from './products.service';

@Controller('merchant/products')
@UseGuards(JwtAuthGuard, MerchantStaffGuard)
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
  create(@MerchantId() merchantId: bigint, @Body() dto: CreateProductDto) {
    return this.service.create(merchantId, dto);
  }

  @Get(':id')
  get(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.get(merchantId, BigInt(params.id));
  }

  @Patch(':id')
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Patch(':id/status')
  updateStatus(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductStatusDto,
  ) {
    return this.service.updateStatus(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  disable(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.disable(merchantId, BigInt(params.id));
  }
}
