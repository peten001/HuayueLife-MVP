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
  ClaimPrintJobDto,
  ExtendPrintJobLeaseDto,
  FailPrintingDto,
  FinishPrintingDto,
  MarkPrintingDto,
  ReportTerminalPrinterStatusDto,
  TerminalHeartbeatDto,
} from '../dto/terminal-connector.dto';
import { PairTerminalDto } from '../dto/terminal.dto';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { PrintAttemptsService } from '../services/print-attempts.service';
import { PrintJobsService } from '../services/print-jobs.service';
import { TerminalConnectorService } from '../services/terminal-connector.service';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';

const SAFE_AUTOMATIC_RETRY_CODES = new Set<string>([
  PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
  PRINTING_ERROR_CODES.PRINTER_OFFLINE,
  PRINTING_ERROR_CODES.USB_DEVICE_DETACHED,
  PRINTING_ERROR_CODES.USB_WRITE_FAILED,
]);

@Controller('terminal')
export class TerminalPairingController {
  constructor(private readonly credentials: TerminalCredentialsService) {}

  @Post('pair')
  pair(@Body() dto: PairTerminalDto, @Req() request: RequestWithContext) {
    return this.credentials.pair(dto, request.requestId);
  }
}

@Controller('terminal')
@UseGuards(TerminalAuthGuard)
export class TerminalConnectorController {
  constructor(
    private readonly connector: TerminalConnectorService,
    private readonly jobs: PrintJobsService,
    private readonly attempts: PrintAttemptsService,
  ) {}

  @Post('heartbeat')
  heartbeat(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: TerminalHeartbeatDto,
  ) {
    return this.connector.heartbeat(terminal, dto);
  }

  @Get('config')
  config(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    return this.connector.configFor(terminal);
  }

  @Get('jobs/active')
  @UseGuards(ActiveTerminalGuard)
  async activeJob(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    const active = await this.jobs.findActiveTerminalJob(
      terminal.merchantId,
      terminal.id,
    );
    return {
      job: active
        ? await this.jobs.connectorJobPayload(
            terminal.merchantId,
            terminal.id,
            active.id,
          )
        : null,
    };
  }

  @Post('jobs/claim')
  @UseGuards(ActiveTerminalGuard)
  async claim(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ClaimPrintJobDto,
  ) {
    const claimed = await this.jobs.claimNextJob(
      terminal.merchantId,
      terminal.id,
      dto.leaseMs,
      dto.allowAutomatic,
    );
    return {
      job: claimed
        ? await this.jobs.connectorJobPayload(
            terminal.merchantId,
            terminal.id,
            claimed.id,
          )
        : null,
    };
  }

  @Post('jobs/:id/printing')
  @UseGuards(ActiveTerminalGuard)
  async markPrinting(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: MarkPrintingDto,
  ) {
    const result = await this.attempts.markPrinting({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      jobId: BigInt(params.id),
      leaseVersion: dto.leaseVersion,
      adapter: dto.adapter,
      appVersion: dto.appVersion,
      networkInfo: dto.networkInfo,
      contentHash: dto.contentHash,
    });
    return {
      job: await this.jobs.connectorJobPayload(
        terminal.merchantId,
        terminal.id,
        result.job.id,
      ),
      attempt: result.attempt,
    };
  }

  @Post('jobs/:id/succeeded')
  @UseGuards(ActiveTerminalGuard)
  markSucceeded(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
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
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      jobId: BigInt(params.id),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      bytesWritten: dto.bytesWritten,
    });
  }

  @Post('jobs/:id/failed')
  @UseGuards(ActiveTerminalGuard)
  markFailed(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
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
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
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

  @Post('jobs/:id/extend-lease')
  @UseGuards(ActiveTerminalGuard)
  extendLease(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: ExtendPrintJobLeaseDto,
  ) {
    return this.attempts.extendLease(
      terminal.merchantId,
      terminal.id,
      BigInt(params.id),
      dto.leaseVersion,
      dto.leaseMs,
    );
  }

  @Post('printers/status')
  @UseGuards(ActiveTerminalGuard)
  reportPrinterStatus(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ReportTerminalPrinterStatusDto,
  ) {
    return this.connector.reportPrinterStatus(terminal, dto);
  }
}
