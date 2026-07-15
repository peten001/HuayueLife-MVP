import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { MerchantId } from '../../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../../common/guards/merchant-role.guard';
import { AuthUser } from '../../../common/types/auth-user.type';
import { RequestWithContext } from '../../../common/types/request.type';
import {
  CreateManualOrderPrintJobDto,
  CreateManualReprintJobDto,
  CreateManualTableBillPrintJobDto,
  CreatePrinterTestJobDto,
  ListPrintJobsQueryDto,
  PrintJobActionDto,
} from '../dto/print-job.dto';
import { UpdateMerchantPrintingSettingsDto } from '../dto/terminal-connector.dto';
import { ActiveMerchantStaffGuard } from '../guards/active-merchant-staff.guard';
import { CreatePrintRuleDto, UpdatePrintRuleDto } from '../dto/print-rule.dto';
import {
  CreatePrintingPrinterDto,
  UpdatePrintingPrinterDto,
} from '../dto/printer.dto';
import {
  CreateReceiptTemplateDto,
  UpdateReceiptTemplateDto,
} from '../dto/receipt-template.dto';
import {
  CreateMerchantTerminalDto,
  GenerateTerminalPairingCodeDto,
  UpdateMerchantTerminalDto,
} from '../dto/terminal.dto';
import { PrintJobsService } from '../services/print-jobs.service';
import { PrintRulesService } from '../services/print-rules.service';
import { PrintingFeatureFlagsService } from '../services/printing-feature-flags.service';
import { PrintingPrintersService } from '../services/printing-printers.service';
import { PrintingSettingsService } from '../services/printing-settings.service';
import { ReceiptTemplatesService } from '../services/receipt-templates.service';
import { TerminalsService } from '../services/terminals.service';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';

@Controller('merchant/printing')
@UseGuards(JwtAuthGuard, ActiveMerchantStaffGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantPrintingController {
  constructor(
    private readonly printers: PrintingPrintersService,
    private readonly templates: ReceiptTemplatesService,
    private readonly rules: PrintRulesService,
    private readonly jobs: PrintJobsService,
    private readonly terminals: TerminalsService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
    private readonly credentials: TerminalCredentialsService,
  ) {}

  @Get('feature-state')
  async featureState(@MerchantId() merchantId: bigint) {
    const settings = await this.settings.get(merchantId);
    return {
      ...this.flags.status(),
      merchantPrintingEnabled: settings.printingEnabled,
    };
  }

  @Get('settings')
  getSettings(@MerchantId() merchantId: bigint) {
    return this.settings.get(merchantId);
  }

  @Patch('settings')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updateSettings(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: UpdateMerchantPrintingSettingsDto,
  ) {
    return this.settings.update(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      dto.printingEnabled,
    );
  }

  @Get('printers')
  listPrinters(@MerchantId() merchantId: bigint) {
    return this.printers.list(merchantId);
  }

  @Post('printers')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  createPrinter(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreatePrintingPrinterDto,
  ) {
    return this.printers.create(merchantId, BigInt(staff.sub), request.requestId, dto);
  }

  @Get('printers/:id')
  getPrinter(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.printers.get(merchantId, BigInt(params.id));
  }

  @Patch('printers/:id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updatePrinter(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: UpdatePrintingPrinterDto,
  ) {
    return this.printers.update(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto,
    );
  }

  @Post('printers/:id/disable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disablePrinter(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.printers.disable(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Post('printers/:id/test-job')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  createPrinterTestJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: CreatePrinterTestJobDto,
  ) {
    return this.jobs.createSafeUsbTestJob(
      merchantId,
      BigInt(params.id),
      BigInt(staff.sub),
      request.requestId,
      dto.requestKey,
    );
  }

  @Get('templates')
  listTemplates(@MerchantId() merchantId: bigint) {
    return this.templates.list(merchantId);
  }

  @Post('templates')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  createTemplate(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreateReceiptTemplateDto,
  ) {
    return this.templates.create(merchantId, BigInt(staff.sub), request.requestId, dto);
  }

  @Get('templates/:id')
  getTemplate(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.templates.get(merchantId, BigInt(params.id));
  }

  @Patch('templates/:id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updateTemplate(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: UpdateReceiptTemplateDto,
  ) {
    return this.templates.update(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto,
    );
  }

  @Post('templates/:id/duplicate')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  duplicateTemplate(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.templates.duplicate(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Get('rules')
  listRules(@MerchantId() merchantId: bigint) {
    return this.rules.list(merchantId);
  }

  @Post('rules')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  createRule(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreatePrintRuleDto,
  ) {
    return this.rules.create(merchantId, BigInt(staff.sub), request.requestId, dto);
  }

  @Patch('rules/:id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updateRule(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: UpdatePrintRuleDto,
  ) {
    return this.rules.update(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto,
    );
  }

  @Post('rules/:id/enable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  enableRule(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.rules.enable(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Post('rules/:id/disable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disableRule(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.rules.disable(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Get('jobs')
  listJobs(
    @MerchantId() merchantId: bigint,
    @Query() query: ListPrintJobsQueryDto,
  ) {
    return this.jobs.list(merchantId, query);
  }

  @Post('jobs/order')
  createOrderPrintJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreateManualOrderPrintJobDto,
  ) {
    return this.jobs.createManualPrintJob({
      merchantId,
      createdByStaffId: BigInt(staff.sub),
      requestId: request.requestId,
      requestKey: dto.requestKey,
      printerId: BigInt(dto.printerId),
      orderId: BigInt(dto.orderId),
      receiptType: 'ORDER_CUSTOMER',
    });
  }

  @Post('jobs/table-bill')
  createTableBillPrintJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreateManualTableBillPrintJobDto,
  ) {
    return this.jobs.createManualPrintJob({
      merchantId,
      createdByStaffId: BigInt(staff.sub),
      requestId: request.requestId,
      requestKey: dto.requestKey,
      printerId: BigInt(dto.printerId),
      tableSessionId: BigInt(dto.tableSessionId),
      receiptType: 'TABLE_BILL',
    });
  }

  @Get('jobs/:id')
  getJob(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.jobs.get(merchantId, BigInt(params.id));
  }

  @Post('jobs/:id/reprint')
  createReprintJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: CreateManualReprintJobDto,
  ) {
    return this.jobs.createManualReprintJob({
      merchantId,
      originalJobId: BigInt(params.id),
      createdByStaffId: BigInt(staff.sub),
      requestId: request.requestId,
      requestKey: dto.requestKey,
      reason: dto.reason.trim(),
      printerId: dto.printerId ? BigInt(dto.printerId) : undefined,
    });
  }

  @Post('jobs/:id/cancel')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  cancelJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: PrintJobActionDto,
  ) {
    return this.jobs.cancel(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto.reason,
    );
  }

  @Post('jobs/:id/retry')
  retryJob(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: PrintJobActionDto,
  ) {
    return this.jobs.retry(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto.reason,
    );
  }

  @Get('terminals')
  listTerminals(@MerchantId() merchantId: bigint) {
    return this.terminals.list(merchantId);
  }

  @Get('terminals/:id')
  getTerminal(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.terminals.get(merchantId, BigInt(params.id));
  }

  @Post('terminals')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  createTerminal(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Body() dto: CreateMerchantTerminalDto,
  ) {
    return this.terminals.create(merchantId, BigInt(staff.sub), request.requestId, dto);
  }

  @Patch('terminals/:id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  updateTerminal(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: UpdateMerchantTerminalDto,
  ) {
    return this.terminals.update(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto,
    );
  }

  @Post('terminals/:id/pairing-code')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  generateTerminalPairingCode(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: GenerateTerminalPairingCodeDto,
  ) {
    return this.credentials.generatePairingCode(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto.expiresInMinutes,
    );
  }

  @Post('terminals/:id/rotate-credentials')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  rotateTerminalCredentials(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
    @Body() dto: GenerateTerminalPairingCodeDto,
  ) {
    return this.credentials.generatePairingCode(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
      dto.expiresInMinutes,
      true,
    );
  }

  @Post('terminals/:id/enable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  enableTerminal(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.terminals.enable(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Post('terminals/:id/disable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disableTerminal(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.terminals.disable(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Post('terminals/:id/reset-usb-config')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  resetTerminalUsbConfig(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.terminals.resetUsbConfig(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }

  @Post('terminals/:id/revoke')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  revokeTerminal(
    @MerchantId() merchantId: bigint,
    @CurrentUser() staff: AuthUser,
    @Req() request: RequestWithContext,
    @Param() params: IdParamDto,
  ) {
    return this.terminals.revoke(
      merchantId,
      BigInt(staff.sub),
      request.requestId,
      BigInt(params.id),
    );
  }
}
