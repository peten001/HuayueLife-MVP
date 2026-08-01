import { Module } from '@nestjs/common';
import { MerchantPrintingController } from './controllers/merchant-printing.controller';
import {
  TerminalConnectorController,
  TerminalPairingController,
} from './controllers/terminal-connector.controller';
import { TerminalHeartbeatController } from './controllers/terminal-heartbeat.controller';
import { V2TerminalBootstrapController } from './controllers/v2-terminal-bootstrap.controller';
import { V2TerminalConnectorController } from './controllers/v2-terminal-connector.controller';
import { TerminalAuthGuard } from './guards/terminal-auth.guard';
import { ActiveMerchantStaffGuard } from './guards/active-merchant-staff.guard';
import { ActiveTerminalGuard } from './guards/active-terminal.guard';
import { TerminalHeartbeatAuthGuard } from './guards/terminal-heartbeat-auth.guard';
import { V2TerminalAuthGuard } from './guards/v2-terminal-auth.guard';
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
import { CloudPrintingService } from './services/cloud-printing.service';
import { CloudPrintExecutionService } from './services/cloud-print-execution.service';
import { LanTerminalBindingsService } from './services/lan-terminal-bindings.service';
import { LanTerminalConnectorController } from './controllers/lan-terminal-connector.controller';
import { V2TerminalBindingsService } from './services/v2-terminal-bindings.service';
import { V2TerminalExecutionService } from './services/v2-terminal-execution.service';

@Module({
  controllers: [
    MerchantPrintingController,
    TerminalPairingController,
    TerminalHeartbeatController,
    TerminalConnectorController,
    LanTerminalConnectorController,
    V2TerminalBootstrapController,
    V2TerminalConnectorController,
  ],
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
    CloudPrintingService,
    CloudPrintExecutionService,
    TerminalConnectorService,
    LanTerminalBindingsService,
    V2TerminalBindingsService,
    V2TerminalExecutionService,
    TerminalAuthGuard,
    TerminalHeartbeatAuthGuard,
    V2TerminalAuthGuard,
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
