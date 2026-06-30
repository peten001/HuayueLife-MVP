import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import {
  UpsertBusinessTypeDto,
  UpsertPromotionTagDto,
} from './dto/platform-dictionary.dto';
import { PlatformDictionariesService } from './platform-dictionaries.service';

@Controller()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformDictionariesController {
  constructor(private readonly service: PlatformDictionariesService) {}

  @Get('platform/merchant-types')
  listBusinessTypes() {
    return this.service.listBusinessTypes();
  }

  @Post('platform/merchant-types')
  createBusinessType(@Body() dto: UpsertBusinessTypeDto) {
    return this.service.createBusinessType(dto);
  }

  @Patch('platform/merchant-types/:id')
  updateBusinessType(@Param() params: IdParamDto, @Body() dto: UpsertBusinessTypeDto) {
    return this.service.updateBusinessType(BigInt(params.id), dto);
  }

  @Delete('platform/merchant-types/:id')
  disableBusinessType(@Param() params: IdParamDto) {
    return this.service.disableBusinessType(BigInt(params.id));
  }

  @Get('platform/promotion-tags')
  listPromotionTags() {
    return this.service.listPromotionTags();
  }

  @Post('platform/promotion-tags')
  createPromotionTag(@Body() dto: UpsertPromotionTagDto) {
    return this.service.createPromotionTag(dto);
  }

  @Patch('platform/promotion-tags/:id')
  updatePromotionTag(@Param() params: IdParamDto, @Body() dto: UpsertPromotionTagDto) {
    return this.service.updatePromotionTag(BigInt(params.id), dto);
  }

  @Delete('platform/promotion-tags/:id')
  disablePromotionTag(@Param() params: IdParamDto) {
    return this.service.disablePromotionTag(BigInt(params.id));
  }

  @Get('platform/capabilities')
  listCapabilities() {
    return this.service.listCapabilities();
  }
}
