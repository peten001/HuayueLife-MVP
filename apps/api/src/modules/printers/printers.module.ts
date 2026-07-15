import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PrintingModule } from '../printing/printing.module';
import { PrintersController } from './printers.controller';
import { PrintersService } from './printers.service';

@Module({
  imports: [DatabaseModule, PrintingModule],
  controllers: [PrintersController],
  providers: [PrintersService],
  exports: [PrintersService],
})
export class PrintersModule {}
