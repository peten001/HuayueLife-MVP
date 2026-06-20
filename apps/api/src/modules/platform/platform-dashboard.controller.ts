import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformDashboardService } from './platform-dashboard.service';

@Controller('platform/dashboard')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformDashboardController {
  constructor(private readonly service: PlatformDashboardService) {}

  @Get()
  getDashboard() {
    return this.service.getDashboard();
  }
}
