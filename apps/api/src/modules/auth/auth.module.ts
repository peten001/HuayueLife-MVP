import { Module } from '@nestjs/common';
import {
  MerchantStaffGuard,
  UserAccountGuard,
} from '../../common/guards/account-type.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    MerchantStaffGuard,
    MerchantRoleGuard,
    UserAccountGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    MerchantStaffGuard,
    MerchantRoleGuard,
    UserAccountGuard,
  ],
})
export class AuthModule {}
