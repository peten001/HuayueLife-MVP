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
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('merchant/categories')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    return this.service.list(merchantId);
  }

  @Post()
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  create(
    @MerchantId() merchantId: bigint,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.service.create(merchantId, dto);
  }

  @Patch(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disable(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.disable(merchantId, BigInt(params.id));
  }
}
