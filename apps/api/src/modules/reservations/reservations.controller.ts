import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreateDiningReservationDto, ReservationActionDto, ReservationParamsDto, ReservationTimeReplyDto } from './reservation.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}
  @Post()
  create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateDiningReservationDto) {
    return this.service.create(BigInt(user.sub), key ?? '', dto);
  }
  @Get()
  list(@CurrentUser() user: AuthUser) { return this.service.listUser(BigInt(user.sub)); }
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParamDto) { return this.service.getUser(BigInt(user.sub), BigInt(p.id)); }
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param() p: IdParamDto) { return this.service.cancelUser(BigInt(user.sub), BigInt(p.id)); }
  @Post(':kind/:id/reply-time')
  reply(@CurrentUser() user: AuthUser, @Param() p: ReservationParamsDto, @Body() dto: ReservationTimeReplyDto) {
    return this.service.replyTime(BigInt(user.sub), p.kind, BigInt(p.id), dto);
  }
}

@Controller('merchant/reservations')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantReservationsController {
  constructor(private readonly service: ReservationsService) {}
  @Get()
  list(@MerchantId() merchantId: bigint) { return this.service.listMerchant(merchantId); }
  @Post(':kind/:id/actions')
  action(@MerchantId() merchantId: bigint, @CurrentUser() staff: AuthUser, @Param() p: ReservationParamsDto, @Body() dto: ReservationActionDto) {
    return this.service.merchantAction(merchantId, BigInt(staff.sub), p.kind, BigInt(p.id), dto);
  }
}
