import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantStaffGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UpdateMerchantProfileDto } from './dto/update-merchant-profile.dto';
import { MerchantProfileService } from './merchant-profile.service';

@Controller('merchant/profile')
@UseGuards(JwtAuthGuard, MerchantStaffGuard)
export class MerchantProfileController {
  constructor(private readonly service: MerchantProfileService) {}

  @Get()
  getProfile(@MerchantId() merchantId: bigint) {
    return this.service.getProfile(merchantId);
  }

  @Patch()
  updateProfile(
    @MerchantId() merchantId: bigint,
    @Body() dto: UpdateMerchantProfileDto,
  ) {
    return this.service.updateProfile(merchantId, dto);
  }
}
