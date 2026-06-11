import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { MerchantLoginDto } from './dto/merchant-login.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/wechat/login')
  loginWithWechat(@Body() dto: WechatLoginDto) {
    return this.authService.loginWithWechat(dto);
  }

  @Post('merchant/auth/login')
  loginMerchant(@Body() dto: MerchantLoginDto) {
    return this.authService.loginMerchant(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthUser) {
    return this.authService.getUserProfile(user);
  }

  @Get('merchant/me')
  @UseGuards(JwtAuthGuard, MerchantRoleGuard)
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
  getMerchantMe(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
