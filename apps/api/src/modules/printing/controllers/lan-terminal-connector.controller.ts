import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IdParamDto } from '../../../common/dto/id-param.dto';
import { RequestWithContext } from '../../../common/types/request.type';
import { CurrentTerminal } from '../decorators/current-terminal.decorator';
import { SyncLanTerminalBindingDto } from '../dto/lan-terminal-binding.dto';
import {
  ClaimLanPrintJobDto,
  ExtendLanPrintJobLeaseDto,
  FailLanPrintingDto,
  FinishLanPrintingDto,
  LanActiveJobQueryDto,
  MarkLanPrintingDto,
  ReportLanPrinterStatusDto,
} from '../dto/lan-terminal-connector.dto';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { LanTerminalBindingsService } from '../services/lan-terminal-bindings.service';
import { PrintAttemptsService } from '../services/print-attempts.service';
import { PrintJobsService } from '../services/print-jobs.service';
import { TerminalConnectorService } from '../services/terminal-connector.service';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';
import { ANDROID_LAN_ESCPOS_ADAPTER } from '../types/lan-terminal-binding';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';

const SAFE_ZERO_BYTE_RETRY_CODES = new Set<string>([
  PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
  PRINTING_ERROR_CODES.PRINTER_OFFLINE,
]);

@Controller('terminal/lan')
@UseGuards(TerminalAuthGuard)
export class LanTerminalConnectorController {
  constructor(
    private readonly credentials: TerminalCredentialsService,
    private readonly connector: TerminalConnectorService,
    private readonly bindings: LanTerminalBindingsService,
    private readonly jobs: PrintJobsService,
    private readonly attempts: PrintAttemptsService,
  ) {}

  @Post('credential/renew')
  @UseGuards(ActiveTerminalGuard)
  renewCredential(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: RequestWithContext,
  ) {
    return this.credentials.renewLanTerminalCredential(
      terminal,
      request.requestId,
    );
  }

  @Get('config')
  config(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    return this.connector.lanConfigFor(terminal);
  }

  @Post('bindings/sync')
  @UseGuards(ActiveTerminalGuard)
  syncBinding(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: RequestWithContext,
    @Body() dto: SyncLanTerminalBindingDto,
  ) {
    return this.bindings.sync(terminal, request.requestId, dto);
  }

  @Get('jobs/active')
  @UseGuards(ActiveTerminalGuard)
  async activeJob(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Query() query: LanActiveJobQueryDto,
  ) {
    const printerId = databaseId(query.printerId, 'printerId');
    const active = await this.jobs.findActiveLanTerminalJob(
      terminal.merchantId,
      terminal.id,
      printerId,
      query.localBindingId,
      query.bindingVersion,
    );
    return {
      job: active
        ? await this.jobs.connectorJobPayload(
            terminal.merchantId,
            terminal.id,
            active.id,
            printerId,
            query.localBindingId,
            query.bindingVersion,
          )
        : null,
    };
  }

  @Post('jobs/claim')
  @UseGuards(ActiveTerminalGuard)
  async claim(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ClaimLanPrintJobDto,
  ) {
    const printerId = databaseId(dto.printerId, 'printerId');
    const claimed = await this.jobs.claimNextLanTerminalJob(
      terminal.merchantId,
      terminal.id,
      printerId,
      dto.localBindingId,
      dto.bindingVersion,
      dto.leaseMs,
      dto.allowAutomatic,
    );
    return {
      job: claimed
        ? await this.jobs.connectorJobPayload(
            terminal.merchantId,
            terminal.id,
            claimed.id,
            printerId,
            dto.localBindingId,
            dto.bindingVersion,
          )
        : null,
    };
  }

  @Post('jobs/:id/printing')
  @UseGuards(ActiveTerminalGuard)
  async markPrinting(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: MarkLanPrintingDto,
  ) {
    const printerId = databaseId(dto.printerId, 'printerId');
    const result = await this.attempts.markPrinting({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId,
      jobId: databaseId(params.id, 'id'),
      leaseVersion: dto.leaseVersion,
      adapter: ANDROID_LAN_ESCPOS_ADAPTER,
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
        printerId,
        dto.localBindingId,
        dto.bindingVersion,
      ),
      attempt: result.attempt,
    };
  }

  @Post('jobs/:id/succeeded')
  @UseGuards(ActiveTerminalGuard)
  markSucceeded(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: FinishLanPrintingDto,
  ) {
    if (dto.bytesWritten <= 0) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'LAN 成功回报必须包含大于 0 的已写入字节数',
      });
    }
    return this.attempts.markSucceeded({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId: databaseId(dto.printerId, 'printerId'),
      jobId: databaseId(params.id, 'id'),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      actualPayloadSha256: dto.actualPayloadSha256,
      transport: dto.transport,
      bytesWritten: dto.bytesWritten,
      localBindingId: dto.localBindingId,
      bindingVersion: dto.bindingVersion,
    }).then((ack) => ({
      jobId: ack.jobId,
      status: ack.status,
    }));
  }

  @Post('jobs/:id/failed')
  @UseGuards(ActiveTerminalGuard)
  markFailed(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: FailLanPrintingDto,
  ) {
    this.assertCanonicalFailure(dto);
    return this.attempts.markFailed({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      printerId: databaseId(dto.printerId, 'printerId'),
      jobId: databaseId(params.id, 'id'),
      attemptNo: dto.attemptNo,
      leaseVersion: dto.leaseVersion,
      retryable: dto.retryable,
      errorCode: dto.errorCode,
      errorMessage: dto.errorMessage,
      printerResponse: dto.printerResponse,
      contentHash: dto.contentHash,
      actualPayloadSha256: dto.actualPayloadSha256,
      transport: dto.transport,
      bytesWritten: dto.bytesWritten,
      localBindingId: dto.localBindingId,
      bindingVersion: dto.bindingVersion,
    }).then((ack) => ({
      jobId: ack.jobId,
      status: ack.status,
    }));
  }

  @Post('jobs/:id/extend')
  @UseGuards(ActiveTerminalGuard)
  async extendLease(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: ExtendLanPrintJobLeaseDto,
  ) {
    const job = await this.attempts.extendLease(
      terminal.merchantId,
      terminal.id,
      databaseId(params.id, 'id'),
      dto.leaseVersion,
      dto.leaseMs,
      dto.localBindingId,
      dto.bindingVersion,
      databaseId(dto.printerId, 'printerId'),
    );
    return {
      leaseVersion: job.leaseVersion,
      leaseExpiresAt: job.leaseExpiresAt,
    };
  }

  @Post('printers/status')
  @UseGuards(ActiveTerminalGuard)
  reportPrinterStatus(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: ReportLanPrinterStatusDto,
  ) {
    databaseId(dto.printerId, 'printerId');
    return this.bindings.reportStatus(terminal, dto);
  }

  private assertCanonicalFailure(dto: FailLanPrintingDto) {
    const uncertain = dto.outcome === 'UNCERTAIN';
    if (dto.bytesWritten > 0 || uncertain) {
      if (
        !uncertain ||
        dto.errorCode !== PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN ||
        dto.retryable
      ) {
        this.invalidFailure();
      }
      return;
    }
    if (
      dto.outcome !== 'FAILED' ||
      ![
        PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
        PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        PRINTING_ERROR_CODES.UNKNOWN,
      ].includes(dto.errorCode as 'NETWORK_TIMEOUT' | 'PRINTER_OFFLINE' | 'UNKNOWN') ||
      (dto.retryable && !SAFE_ZERO_BYTE_RETRY_CODES.has(dto.errorCode)) ||
      (dto.errorCode === PRINTING_ERROR_CODES.UNKNOWN && dto.retryable)
    ) {
      this.invalidFailure();
    }
  }

  private invalidFailure(): never {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message:
        'LAN 失败回报必须使用规范错误映射；部分写入或不确定结果禁止自动重试',
    });
  }
}

function databaseId(value: string, name: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: `${name} 必须是有效数字 ID`,
    });
  }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: `${name} 必须是有效数字 ID`,
    });
  }
  return parsed;
}
