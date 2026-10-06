import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { Matches } from 'class-validator';
import { ExploreCategoryDto, ExploreTopicDto, ServiceItemDto } from './explore.dto';
import { ExploreService } from './explore.service';

class ContentCodeParams { @Matches(/^[a-z][a-z0-9_-]{0,47}$/) code!: string; }
class ServiceParams { @Matches(/^[1-9]\d*$/) id!: string; @Matches(/^[1-9]\d*$/) itemId!: string; }

@Controller()
export class PublicExploreController {
  constructor(private readonly service: ExploreService) {}
  @Get('public/explore') content() { return this.service.publicContent(); }
  @Get('merchants/:id/service-items') items(@Param() params: IdParamDto) { return this.service.listServices(BigInt(params.id), true); }
}

@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformExploreController {
  constructor(private readonly service: ExploreService) {}
  @Get('explore/categories') categories() { return this.service.categories(true); }
  @Put('explore/categories') category(@Body() dto: ExploreCategoryDto) { return this.service.saveCategory(dto); }
  @Get('explore/topics') topics() { return this.service.topics(true); }
  @Put('explore/topics') topic(@Body() dto: ExploreTopicDto) { return this.service.saveTopic(dto); }
  @Delete('explore/topics/:code') deleteTopic(@Param() params: ContentCodeParams) { return this.service.deleteTopic(params.code); }
  @Post('explore/initialize') initialize() { return this.service.seedDefaults(); }
  @Get('merchants/:id/service-items') items(@Param() params: IdParamDto) { return this.service.listServices(BigInt(params.id)); }
  @Post('merchants/:id/service-items') create(@Param() params: IdParamDto, @Body() dto: ServiceItemDto) { return this.service.saveService(BigInt(params.id), dto); }
  @Put('merchants/:id/service-items/:itemId') update(@Param() params: ServiceParams, @Body() dto: ServiceItemDto) { return this.service.saveService(BigInt(params.id), dto, BigInt(params.itemId)); }
  @Delete('merchants/:id/service-items/:itemId') delete(@Param() params: ServiceParams) { return this.service.deleteService(BigInt(params.id), BigInt(params.itemId)); }
}
