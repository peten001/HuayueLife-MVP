import {
  BadRequestException,
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
import {
  ClaimPrintJobDto,
  ExtendPrintJobLeaseDto,
  FailPrintingDto,
  FinishPrintingDto,
  MarkPrintingDto,
  ReportTerminalPrinterStatusDto,
  UpdateMerchantPrintingSettingsDto,
} from '../dto/terminal-connector.dto';
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
import { PrintAttemptsService } from '../services/print-attempts.service';
import { PrintJobsService } from '../services/print-jobs.service';
import { PrintRulesService } from '../services/print-rules.service';
import { PrintingFeatureFlagsService } from '../services/printing-feature-flags.service';
import { PrintingPrintersService } from '../services/printing-printers.service';
import { PrintingSettingsService } from '../services/printing-settings.service';
import { ReceiptTemplatesService } from '../services/receipt-templates.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

const SAFE_AUTOMATIC_RETRY_CODES = new Set<string>([
  PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
  PRINTING_ERROR_CODES.PRINTER_OFFLINE,
  PRINTING_ERROR_CODES.USB_DEVICE_DETACHED,
  PRINTING_ERROR_CODES.USB_WRITE_FAILED,
]);

@Controller('merchant/printing')
@UseGuards(JwtAuthGuard, ActiveMerchantStaffGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantPrintingController {
  constructor(
    private readonly printers: PrintingPrintersService,
    private readonly templates: ReceiptTemplatesService,
    private readonly rules: PrintRulesService,
    private readonly jobs: PrintJobsService,
    private readonly attempts: PrintAttemptsService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
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

  @Get('connector/config')
  connectorConfig(@MerchantId() merchantId: bigint) {
    return this.jobs.merchantConnectorConfig(merchantId);
  }

  @Get('connector/jobs/active')
  async activeConnectorJob(@MerchantId() merchantId: bigint, @Query('printerId') printerId?: string) {
    const active = await this.jobs.findActiveMerchantConnectorJob(
      merchantId,
      optionalNumericId(printerId, 'printerId'),
    );
    return {
      job: active
        ? await this.jobs.connectorJobPayload(merchantId, null, active.id)
        : null,
    };
  }

  @Post('connector/jobs/claim')
  async claimConnectorJob(
    @MerchantId() merchantId: bigint,
    @Body() dto: ClaimPrintJobDto,
  ) {
    const claimed = await this.jobs.claimNextMerchantJob(
      merchantId,
      optionalNumericId(dto.printerId, 'printerId'),
      dto.leaseMs,
      dto.allowAutomatic,
    );
    return {
      job: claimed
        ? await this.jobs.connectorJobPayload(merchantId, null, claimed.id)
        : null,
    };
  }

  @Post('connector/jobs/:id/printing')
  async markConnectorPrinting(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: MarkPrintingDto,
  ) {
    const result = await this.attempts.markPrinting({
      merchantId,
      terminalId: null,
      jobId: BigInt(params.id),
      leaseVersion: dto.leaseVersion,
      adapter: dto.adapter,
      appVersion: dto.appVersion,
      networkInfo: dto.networkInfo,
      contentHash: dto.contentHash,
    });
    return {
      job: await this.jobs.connectorJobPayload(merchantId, null, result.job.id),
      attempt: result.attempt,
    };
  }

  @Post('connector/jobs/:id/succeeded')
  markConnectorSucceeded(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: FinishPrintingDto,
  ) {
    if (dto.bytesWritten <= 0) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '成功回报必须包含大于 0 的已写入字节数',
      });
    }
    return this.attempts.markSucceeded({
      merchantId,
      terminalId: null,
      jobId: BigInt(params.id),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      bytesWritten: dto.bytesWritten,
    });
  }

  @Post('connector/jobs/:id/failed')
  markConnectorFailed(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: FailPrintingDto,
  ) {
    const uncertain = dto.outcome === 'UNCERTAIN';
    if (
      uncertain !==
        (dto.errorCode === PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN) ||
      (uncertain && dto.retryable) ||
      (dto.bytesWritten > 0 && !uncertain) ||
      (dto.retryable && !SAFE_AUTOMATIC_RETRY_CODES.has(dto.errorCode))
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          '部分写入或不确定结果必须使用 PRINT_OUTCOME_UNKNOWN 且禁止自动重试',
      });
    }
    return this.attempts.markFailed({
      merchantId,
      terminalId: null,
      jobId: BigInt(params.id),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      retryable: dto.retryable,
      errorCode: dto.errorCode,
      errorMessage: dto.errorMessage,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      bytesWritten: dto.bytesWritten,
    });
  }

  @Post('connector/jobs/:id/extend-lease')
  extendConnectorLease(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: ExtendPrintJobLeaseDto,
  ) {
    return this.attempts.extendLease(
      merchantId,
      null,
      BigInt(params.id),
      dto.leaseVersion,
      dto.leaseMs,
    );
  }

  @Post('connector/printers/status')
  reportConnectorPrinterStatus(
    @MerchantId() merchantId: bigint,
    @Body() dto: ReportTerminalPrinterStatusDto,
  ) {
    return this.jobs.reportMerchantConnectorPrinterStatus(merchantId, dto);
  }
}

function optionalNumericId(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]{0,38}$/.test(value)) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: `${name} 必须是有效数字 ID`,
    });
  }
  return BigInt(value);
}
