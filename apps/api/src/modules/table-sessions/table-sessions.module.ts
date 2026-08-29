import { Module } from '@nestjs/common';
import { PrintingModule } from '../printing/printing.module';
import { MerchantTableSessionsController } from './merchant-table-sessions.controller';
import { DineInCanonicalStateService } from './dine-in-canonical-state.service';
import { TableSessionsService } from './table-sessions.service';

@Module({
  imports: [PrintingModule],
  controllers: [MerchantTableSessionsController],
  providers: [DineInCanonicalStateService, TableSessionsService],
  exports: [DineInCanonicalStateService, TableSessionsService],
})
export class TableSessionsModule {}
