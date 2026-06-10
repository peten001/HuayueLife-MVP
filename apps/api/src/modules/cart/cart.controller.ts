import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartContextQueryDto } from './dto/cart-context-query.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class CartController {
  constructor(private readonly service: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query() query: CartContextQueryDto) {
    return this.service.get(BigInt(user.sub), query);
  }

  @Post('items')
  addItem(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.service.addItem(BigInt(user.sub), dto);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.service.updateItem(BigInt(user.sub), BigInt(params.id), dto);
  }

  @Delete('items/:id')
  deleteItem(@CurrentUser() user: AuthUser, @Param() params: IdParamDto) {
    return this.service.deleteItem(BigInt(user.sub), BigInt(params.id));
  }

  @Delete()
  clear(@CurrentUser() user: AuthUser, @Query() query: CartContextQueryDto) {
    return this.service.clear(BigInt(user.sub), query);
  }
}
