import { Module } from '@nestjs/common';
import { CashierPushController } from './cashier-push.controller';
import { CashierPushService } from './cashier-push.service';
import { ActiveMerchantStaffGuard } from '../printing/guards/active-merchant-staff.guard';

@Module({
  controllers: [CashierPushController],
  providers: [CashierPushService, ActiveMerchantStaffGuard],
  exports: [CashierPushService],
})
export class CashierPushModule {}
