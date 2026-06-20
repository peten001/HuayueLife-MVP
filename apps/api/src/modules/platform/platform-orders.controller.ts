import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ListPlatformOrdersQueryDto } from './dto/list-platform-orders-query.dto';
import { PlatformOrdersService } from './platform-orders.service';

@Controller('platform/orders')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformOrdersController {
  constructor(private readonly service: PlatformOrdersService) {}

  @Get()
  list(@Query() query: ListPlatformOrdersQueryDto) {
    return this.service.list(query);
  }
}
