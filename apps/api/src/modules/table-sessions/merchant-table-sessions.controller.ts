import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { TableIdParamDto } from './dto/table-id-param.dto';
import { TableSessionsService } from './table-sessions.service';

@Controller('merchant')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantTableSessionsController {
  constructor(private readonly service: TableSessionsService) {}

  @Get('table-sessions/open')
  listOpenSessions(@MerchantId() merchantId: bigint) {
    return this.service.listOpenSessions(merchantId);
  }

  @Get('tables/:tableId/current-session')
  getCurrentSession(
    @MerchantId() merchantId: bigint,
    @Param() params: TableIdParamDto,
  ) {
    return this.service.getCurrentSession(merchantId, BigInt(params.tableId));
  }

  @Get('table-sessions/:id')
  getSession(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.getSessionDetail(merchantId, BigInt(params.id));
  }

  @Post('table-sessions/:id/close')
  closeSession(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
  ) {
    return this.service.closeSession(merchantId, BigInt(params.id));
  }
}
