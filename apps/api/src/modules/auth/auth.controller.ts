import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ChangeMerchantPasswordDto } from './dto/change-merchant-password.dto';
import { AuthService } from './auth.service';
import { MerchantLoginDto } from './dto/merchant-login.dto';
import { WechatPhoneDto } from './dto/wechat-phone.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/wechat/login')
  loginWithWechat(@Body() dto: WechatLoginDto) {
    return this.authService.loginWithWechat(dto);
  }

  @Post('auth/wechat/phone')
  @UseGuards(JwtAuthGuard, UserAccountGuard)
  bindWechatPhone(@CurrentUser() user: AuthUser, @Body() dto: WechatPhoneDto) {
    return this.authService.bindWechatPhone(user, dto);
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

  @Get('auth/me')
  @UseGuards(JwtAuthGuard)
  getMeByAuth(@CurrentUser() user: AuthUser) {
    return this.authService.getUserProfile(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, UserAccountGuard)
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.authService.updateUserProfile(user, dto);
  }

  @Patch('auth/me')
  @UseGuards(JwtAuthGuard, UserAccountGuard)
  updateMeByAuth(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.authService.updateUserProfile(user, dto);
  }

  @Get('merchant/me')
  @UseGuards(JwtAuthGuard, MerchantRoleGuard)
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
  getMerchantMe(@CurrentUser() user: AuthUser) {
    return this.authService.getMerchantProfile(user);
  }

  @Post('merchant/profile/change-password')
  @UseGuards(JwtAuthGuard, MerchantRoleGuard)
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
  changeMerchantPassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeMerchantPasswordDto,
  ) {
    return this.authService.changeMerchantPassword(user, dto);
  }
}
