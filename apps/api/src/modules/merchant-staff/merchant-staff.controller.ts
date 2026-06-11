import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { CreateMerchantStaffDto } from './dto/create-merchant-staff.dto';
import { UpdateMerchantStaffDto } from './dto/update-merchant-staff.dto';
import { MerchantStaffService } from './merchant-staff.service';

@Controller('merchant/staff')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER)
export class MerchantStaffController {
  constructor(private readonly service: MerchantStaffService) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    return this.service.list(merchantId);
  }

  @Post()
  create(
    @MerchantId() merchantId: bigint,
    @Body() dto: CreateMerchantStaffDto,
  ) {
    return this.service.create(merchantId, dto);
  }

  @Patch(':id')
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateMerchantStaffDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Post(':id/disable')
  disable(
    @MerchantId() merchantId: bigint,
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
  ) {
    return this.service.disable(
      merchantId,
      BigInt(user.sub),
      BigInt(params.id),
    );
  }

  @Post(':id/reset-password')
  resetPassword(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.resetPassword(merchantId, BigInt(params.id));
  }
}
