import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { CreatePlatformMerchantDto } from './dto/create-platform-merchant.dto';
import { UpdatePlatformMerchantDto } from './dto/update-platform-merchant.dto';
import { PlatformMerchantsService } from './platform-merchants.service';

@Controller('platform/merchants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformMerchantsController {
  constructor(private readonly service: PlatformMerchantsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id/detail')
  detail(@Param() params: IdParamDto) {
    return this.service.detail(BigInt(params.id));
  }

  @Post()
  create(@Body() dto: CreatePlatformMerchantDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param() params: IdParamDto, @Body() dto: UpdatePlatformMerchantDto) {
    return this.service.update(BigInt(params.id), dto);
  }

  @Post(':id/reset-password')
  resetPassword(@Param() params: IdParamDto) {
    return this.service.resetPassword(BigInt(params.id));
  }

  @Post(':id/disable')
  disable(@Param() params: IdParamDto) {
    return this.service.disable(BigInt(params.id));
  }

  @Post(':id/enable')
  enable(@Param() params: IdParamDto) {
    return this.service.enable(BigInt(params.id));
  }

  @Delete(':id')
  delete(@Param() params: IdParamDto) {
    return this.service.delete(BigInt(params.id));
  }
}
