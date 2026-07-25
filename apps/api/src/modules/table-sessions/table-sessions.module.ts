import { Module } from '@nestjs/common';
import { PrintingModule } from '../printing/printing.module';
import { MerchantTableSessionsController } from './merchant-table-sessions.controller';
import { TableSessionsService } from './table-sessions.service';

@Module({
  imports: [PrintingModule],
  controllers: [MerchantTableSessionsController],
  providers: [TableSessionsService],
  exports: [TableSessionsService],
})
export class TableSessionsModule {}
