import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { MerchantId } from '../../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../../common/guards/merchant-role.guard';
import { AuthUser } from '../../../common/types/auth-user.type';
import { RequestWithContext } from '../../../common/types/request.type';
import { BootstrapV2TerminalDto } from '../dto/v2-terminal-connector.dto';
import { ActiveMerchantStaffGuard } from '../guards/active-merchant-staff.guard';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';

@Controller('merchant/printing/connector/v2')
@UseGuards(JwtAuthGuard, ActiveMerchantStaffGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class V2TerminalBootstrapController {
  constructor(private readonly credentials: TerminalCredentialsService) {}

  @Post('bootstrap')
  bootstrap(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: BootstrapV2TerminalDto,
  ) {
    return this.credentials.bootstrapV2Terminal(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      dto,
    );
  }
}
