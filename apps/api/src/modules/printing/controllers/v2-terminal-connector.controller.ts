import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IdParamDto } from '../../../common/dto/id-param.dto';
import { RequestWithContext } from '../../../common/types/request.type';
import { CurrentTerminal } from '../decorators/current-terminal.decorator';
import {
  ArchiveV2BindingDto,
  ClaimV2PrintJobDto,
  ExtendV2PrintJobLeaseDto,
  FailV2PrintingDto,
  FinishV2PrintingDto,
  MarkV2PrintingDto,
  ReportV2PrinterStatusDto,
  SyncV2BindingDto,
} from '../dto/v2-terminal-connector.dto';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { V2TerminalAuthGuard } from '../guards/v2-terminal-auth.guard';
import { PrintAttemptsService } from '../services/print-attempts.service';
import { PrintJobsService } from '../services/print-jobs.service';
import { V2TerminalBindingsService } from '../services/v2-terminal-bindings.service';
import { V2TerminalExecutionService } from '../services/v2-terminal-execution.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';

const SAFE_AUTOMATIC_RETRY_CODES = new Set<string>([
  PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
  PRINTING_ERROR_CODES.PRINTER_OFFLINE,
  PRINTING_ERROR_CODES.USB_DEVICE_DETACHED,
  PRINTING_ERROR_CODES.USB_WRITE_FAILED,
]);

@Controller('terminal/v2')
@UseGuards(V2TerminalAuthGuard)
export class V2TerminalConnectorController {
  constructor(
    private readonly bindings: V2TerminalBindingsService,
    private readonly execution: V2TerminalExecutionService,
    private readonly jobs: PrintJobsService,
    private readonly attempts: PrintAttemptsService,
  ) {}

  @Get('config')
  config(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    return this.bindings.configFor(terminal);
  }

  @Post('bindings/sync')
  @UseGuards(ActiveTerminalGuard)
  syncBinding(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: RequestWithContext,
    @Body() dto: SyncV2BindingDto,
  ) {
    return this.bindings.sync(terminal, request.requestId, dto);
  }

  @Post('bindings/archive')
  @UseGuards(ActiveTerminalGuard)
  archiveBinding(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: RequestWithContext,
    @Body() dto: ArchiveV2BindingDto,
  ) {
    return this.bindings.archive(terminal, request.requestId, dto);
  }

  @Post('printers/status')
  @UseGuards(ActiveTerminalGuard)
  reportStatus(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ReportV2PrinterStatusDto,
  ) {
    return this.bindings.reportStatus(terminal, dto);
  }

  @Get('jobs/active')
  @UseGuards(ActiveTerminalGuard)
  active(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    return this.execution.active(terminal);
  }

  @Post('jobs/claim')
  @UseGuards(ActiveTerminalGuard)
  claim(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ClaimV2PrintJobDto,
  ) {
    return this.execution.claim(terminal, dto);
  }

  @Post('jobs/:id/printing')
  @UseGuards(ActiveTerminalGuard)
  async markPrinting(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: MarkV2PrintingDto,
  ) {
    const { printer } = await this.bindings.requireRoute(
      terminal,
      dto,
      true,
      true,
    );
    const result = await this.attempts.markPrinting({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId: BigInt(dto.printerId),
      jobId: BigInt(params.id),
      leaseVersion: dto.leaseVersion,
      adapter: this.bindings.adapterFor(printer.channelType),
      appVersion: dto.appVersion,
      networkInfo: dto.networkInfo,
      contentHash: dto.contentHash,
      localBindingId: dto.localBindingId,
      bindingVersion: dto.bindingVersion,
    });
    return {
      job: await this.jobs.connectorJobPayload(
        terminal.merchantId,
        terminal.id,
        result.job.id,
        BigInt(dto.printerId),
        dto.localBindingId,
        dto.bindingVersion,
      ),
      attempt: result.attempt,
    };
  }

  @Post('jobs/:id/succeeded')
  @UseGuards(ActiveTerminalGuard)
  async markSucceeded(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: FinishV2PrintingDto,
  ) {
    if (dto.bytesWritten <= 0) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '成功回报必须包含大于 0 的已写入字节数',
      });
    }
    await this.bindings.requireRoute(terminal, dto, true, false);
    return this.attempts.markSucceeded({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId: BigInt(dto.printerId),
      jobId: BigInt(params.id),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      bytesWritten: dto.bytesWritten,
      localBindingId: dto.localBindingId,
      bindingVersion: dto.bindingVersion,
    });
  }

  @Post('jobs/:id/failed')
  @UseGuards(ActiveTerminalGuard)
  async markFailed(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: FailV2PrintingDto,
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
    await this.bindings.requireRoute(terminal, dto, true, false);
    const job = await this.attempts.markFailed({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId: BigInt(dto.printerId),
      jobId: BigInt(params.id),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      retryable: dto.retryable,
      errorCode: dto.errorCode,
      errorMessage: dto.errorMessage,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      bytesWritten: dto.bytesWritten,
      localBindingId: dto.localBindingId,
      bindingVersion: dto.bindingVersion,
    });
    return uncertain ? { ...job, status: 'UNCERTAIN' as const } : job;
  }

  @Post('jobs/:id/extend-lease')
  @UseGuards(ActiveTerminalGuard)
  async extendLease(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: ExtendV2PrintJobLeaseDto,
  ) {
    await this.bindings.requireRoute(terminal, dto, true, false);
    return this.attempts.extendLease(
      terminal.merchantId,
      terminal.id,
      BigInt(params.id),
      dto.leaseVersion,
      dto.leaseMs,
      dto.localBindingId,
      dto.bindingVersion,
      BigInt(dto.printerId),
    );
  }
}
