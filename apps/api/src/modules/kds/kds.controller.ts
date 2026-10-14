import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ActiveMerchantStaffGuard } from '../printing/guards/active-merchant-staff.guard';
import { KdsActionDto, KdsPackDto, KdsSettingsDto, KdsUndoDto } from './kds.dto';
import { KdsService } from './kds.service';

@Controller('merchant/kds')
@UseGuards(JwtAuthGuard, ActiveMerchantStaffGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class KdsController {
  constructor(private readonly service: KdsService) {}
  @Get() board(@MerchantId() id: bigint) { return this.service.board(id); }
  @Patch('settings') @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  settings(@MerchantId() id: bigint, @Body() dto: KdsSettingsDto) { return this.service.settings(id, dto); }
  @Post('actions') action(@MerchantId() id: bigint, @CurrentUser() user: AuthUser, @Body() dto: KdsActionDto) {
    return this.service.action(id, BigInt(user.sub), dto);
  }
  @Post('pack') pack(@MerchantId() id: bigint, @CurrentUser() user: AuthUser, @Body() dto: KdsPackDto) {
    return this.service.pack(id, BigInt(user.sub), dto);
  }
  @Post('undo') undo(@MerchantId() id: bigint, @CurrentUser() user: AuthUser, @Body() dto: KdsUndoDto) {
    return this.service.undo(id, BigInt(user.sub), dto);
  }
}
