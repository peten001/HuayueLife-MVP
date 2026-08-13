import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { MerchantAnalyticsQueryDto } from './dto/merchant-analytics-query.dto';
import { MerchantAnalyticsService } from './merchant-analytics.service';

@Controller('merchant/analytics')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
export class MerchantAnalyticsController {
  constructor(private readonly service: MerchantAnalyticsService) {}

  @Get()
  getAnalytics(
    @MerchantId() merchantId: bigint,
    @Query() query: MerchantAnalyticsQueryDto,
  ) {
    return this.service.getAnalytics(merchantId, query);
  }
}
