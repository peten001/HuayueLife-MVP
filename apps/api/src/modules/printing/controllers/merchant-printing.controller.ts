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
import { ListPrintJobsQueryDto, PrintJobActionDto } from '../dto/print-job.dto';
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
  UpdateMerchantTerminalDto,
} from '../dto/terminal.dto';
import { PrintJobsService } from '../services/print-jobs.service';
import { PrintRulesService } from '../services/print-rules.service';
import { PrintingFeatureFlagsService } from '../services/printing-feature-flags.service';
import { PrintingPrintersService } from '../services/printing-printers.service';
import { ReceiptTemplatesService } from '../services/receipt-templates.service';
import { TerminalsService } from '../services/terminals.service';

@Controller('merchant/printing')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class MerchantPrintingController {
  constructor(
    private readonly printers: PrintingPrintersService,
    private readonly templates: ReceiptTemplatesService,
    private readonly rules: PrintRulesService,
    private readonly jobs: PrintJobsService,
    private readonly terminals: TerminalsService,
    private readonly flags: PrintingFeatureFlagsService,
  ) {}

  @Get('feature-state')
  featureState() {
    return this.flags.status();
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

  @Get('jobs/:id')
  getJob(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.jobs.get(merchantId, BigInt(params.id));
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
