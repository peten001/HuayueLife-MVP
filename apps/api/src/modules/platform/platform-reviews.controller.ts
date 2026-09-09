import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ListPlatformReviewsQueryDto } from './dto/list-platform-reviews-query.dto';
import { PlatformReviewsService } from './platform-reviews.service';

@Controller('platform/reviews')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformReviewsController {
  constructor(private readonly service: PlatformReviewsService) {}

  @Get()
  list(@Query() query: ListPlatformReviewsQueryDto) {
    return this.service.list(query);
  }

  @Post(':id/hide')
  hide(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.hide(BigInt(params.id), user.username ?? user.sub);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.publish(BigInt(params.id), user.username ?? user.sub);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.restore(BigInt(params.id), user.username ?? user.sub);
  }
}
