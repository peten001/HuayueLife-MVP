import { Module } from '@nestjs/common';
import { MerchantTableSessionsController } from './merchant-table-sessions.controller';
import { TableSessionsService } from './table-sessions.service';

@Module({
  controllers: [MerchantTableSessionsController],
  providers: [TableSessionsService],
  exports: [TableSessionsService],
})
export class TableSessionsModule {}
