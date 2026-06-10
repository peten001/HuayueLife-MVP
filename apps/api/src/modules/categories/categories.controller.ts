import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { MerchantStaffGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('merchant/categories')
@UseGuards(JwtAuthGuard, MerchantStaffGuard)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    return this.service.list(merchantId);
  }

  @Post()
  create(
    @MerchantId() merchantId: bigint,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.service.create(merchantId, dto);
  }

  @Patch(':id')
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  disable(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.disable(merchantId, BigInt(params.id));
  }
}
