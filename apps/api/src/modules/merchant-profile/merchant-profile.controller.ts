import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { UpdateMerchantProfileDto } from './dto/update-merchant-profile.dto';
import { MerchantProfileService } from './merchant-profile.service';

@Controller('merchant/profile')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantProfileController {
  constructor(private readonly service: MerchantProfileService) {}

  @Get()
  getProfile(@MerchantId() merchantId: bigint) {
    return this.service.getProfile(merchantId);
  }

  @Patch()
  @MerchantRoles(StaffRole.OWNER)
  updateProfile(
    @MerchantId() merchantId: bigint,
    @Body() dto: UpdateMerchantProfileDto,
  ) {
    return this.service.updateProfile(merchantId, dto);
  }
}
