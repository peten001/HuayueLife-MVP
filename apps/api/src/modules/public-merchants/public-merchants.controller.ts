import { Controller, Get, Param, Query } from '@nestjs/common';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';
import { PublicMerchantsService } from './public-merchants.service';

@Controller()
export class PublicMerchantsController {
  constructor(private readonly service: PublicMerchantsService) {}

  @Get('merchants/nearby')
  nearby(@Query() query: NearbyMerchantsQueryDto) {
    return this.service.nearby(query);
  }

  @Get('merchants/:id')
  detail(@Param() params: IdParamDto) {
    return this.service.detail(BigInt(params.id));
  }

  @Get('merchants/:id/menu')
  menu(@Param() params: IdParamDto, @Query('tableToken') tableToken?: string) {
    return this.service.menu(BigInt(params.id), tableToken);
  }

  @Get('products/:id')
  product(
    @Param() params: IdParamDto,
    @Query('tableToken') tableToken?: string,
  ) {
    return this.service.product(BigInt(params.id), tableToken);
  }
}
