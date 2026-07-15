import { Module } from '@nestjs/common';
import { MerchantPrintingController } from './controllers/merchant-printing.controller';
import { TerminalAuthGuard } from './guards/terminal-auth.guard';
import { ActiveMerchantStaffGuard } from './guards/active-merchant-staff.guard';
import { ActiveTerminalGuard } from './guards/active-terminal.guard';
import { PrintAttemptsService } from './services/print-attempts.service';
import { PrintJobsService } from './services/print-jobs.service';
import { PrintRulesService } from './services/print-rules.service';
import { PrintingAuditService } from './services/printing-audit.service';
import { PrintingFeatureFlagsService } from './services/printing-feature-flags.service';
import { PrintingPrintersService } from './services/printing-printers.service';
import { PrintingSettingsService } from './services/printing-settings.service';
import { ReceiptSnapshotService } from './services/receipt-snapshot.service';
import { ReceiptTemplatesService } from './services/receipt-templates.service';
import { TerminalsService } from './services/terminals.service';
import { TerminalConnectorService } from './services/terminal-connector.service';
import { TerminalCredentialsService } from './services/terminal-credentials.service';

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
    PrintingSettingsService,
    TerminalCredentialsService,
    TerminalConnectorService,
    TerminalAuthGuard,
    ActiveMerchantStaffGuard,
    ActiveTerminalGuard,
  ],
  exports: [
    PrintingFeatureFlagsService,
    PrintJobsService,
    PrintAttemptsService,
    ReceiptSnapshotService,
    PrintingSettingsService,
  ],
})
export class PrintingModule {}
