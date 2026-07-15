import { Module } from '@nestjs/common';
import { MerchantPrintingController } from './controllers/merchant-printing.controller';
import { PrintAttemptsService } from './services/print-attempts.service';
import { PrintJobsService } from './services/print-jobs.service';
import { PrintRulesService } from './services/print-rules.service';
import { PrintingAuditService } from './services/printing-audit.service';
import { PrintingFeatureFlagsService } from './services/printing-feature-flags.service';
import { PrintingPrintersService } from './services/printing-printers.service';
import { ReceiptSnapshotService } from './services/receipt-snapshot.service';
import { ReceiptTemplatesService } from './services/receipt-templates.service';
import { TerminalsService } from './services/terminals.service';

@Module({
  controllers: [MerchantPrintingController],
  providers: [
    PrintingFeatureFlagsService,
    PrintingAuditService,
    PrintingPrintersService,
    ReceiptTemplatesService,
    PrintRulesService,
    ReceiptSnapshotService,
    PrintJobsService,
    PrintAttemptsService,
    TerminalsService,
  ],
  exports: [
    PrintingFeatureFlagsService,
    PrintJobsService,
    PrintAttemptsService,
    ReceiptSnapshotService,
  ],
})
export class PrintingModule {}
