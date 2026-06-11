import { Module } from '@nestjs/common';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { MerchantStaffController } from './merchant-staff.controller';
import { MerchantStaffService } from './merchant-staff.service';

@Module({
  controllers: [MerchantStaffController],
  providers: [MerchantStaffService, MerchantRoleGuard],
})
export class MerchantStaffModule {}
