import { Module } from '@nestjs/common';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { ActiveMerchantStaffGuard } from '../printing/guards/active-merchant-staff.guard';
@Module({ controllers: [KdsController], providers: [KdsService, ActiveMerchantStaffGuard] })
export class KdsModule {}
