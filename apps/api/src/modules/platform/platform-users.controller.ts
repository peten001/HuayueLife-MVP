import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ListPlatformUsersQueryDto } from './dto/list-platform-users-query.dto';
import {
  PlatformUserDetailResponse,
  PlatformUsersListResponse,
  PlatformUsersService,
} from './platform-users.service';

@Controller('platform/users')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformUsersController {
  constructor(private readonly service: PlatformUsersService) {}

  @Get()
  list(@Query() query: ListPlatformUsersQueryDto): Promise<PlatformUsersListResponse> {
    return this.service.list(query);
  }

  @Get(':id/detail')
  detail(@Param() params: IdParamDto): Promise<PlatformUserDetailResponse> {
    return this.service.detail(BigInt(params.id));
  }
}
