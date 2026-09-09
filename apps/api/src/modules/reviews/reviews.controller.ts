import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get('merchants/:id/reviews')
  listPublic(
    @Param() params: IdParamDto,
    @Query() query: ListReviewsQueryDto,
  ) {
    return this.service.listPublic(BigInt(params.id), query.page);
  }

  @Get('orders/:id/review')
  @UseGuards(JwtAuthGuard, UserAccountGuard)
  getOwn(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.getOwn(BigInt(user.sub), BigInt(params.id));
  }

  @Post('orders/:id/review')
  @UseGuards(JwtAuthGuard, UserAccountGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: CreateReviewDto,
  ) {
    return this.service.create(BigInt(user.sub), BigInt(params.id), dto);
  }
}
