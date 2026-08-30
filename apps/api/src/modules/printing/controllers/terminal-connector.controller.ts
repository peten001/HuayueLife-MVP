import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { once } from 'node:events';
import type { Response } from 'express';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
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
  ReportArtifactFailureDto,
  SyncUsbTerminalBindingDto,
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
const gzip = promisify(gzipCallback);
const GZIP_ARTIFACT_ENCODING = 'gzip-v1';

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
  private readonly logger = new Logger(TerminalConnectorController.name);

  constructor(
    private readonly connector: TerminalConnectorService,
    private readonly jobs: PrintJobsService,
    private readonly attempts: PrintAttemptsService,
  ) {}

  @Post('usb/bindings/sync')
  @UseGuards(ActiveTerminalGuard)
  syncUsbBinding(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: RequestWithContext,
    @Body() dto: SyncUsbTerminalBindingDto,
  ) {
    return this.connector.syncUsbBinding(terminal, request.requestId, dto);
  }

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
  async activeJob(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
  ) {
    const active = await this.jobs.findActiveTerminalJob(
      terminal.merchantId,
      terminal.id,
    );
    if (!active) return { job: null };
    const job = await this.jobs.connectorJobPayload(
      terminal.merchantId,
      terminal.id,
      active.id,
    );
    return { job };
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
    if (!claimed) return { job: null };
    const job = await this.jobs.connectorJobPayload(
      terminal.merchantId,
      terminal.id,
      claimed.id,
    );
    return { job };
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
    const job = await this.jobs.connectorJobPayload(
      terminal.merchantId,
      terminal.id,
      result.job.id,
    );
    return {
      job,
      attempt: result.attempt,
    };
  }

  @Get('jobs/:id/artifact')
  @UseGuards(ActiveTerminalGuard)
  async artifact(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Headers('x-yunqiao-artifact-retry-count') retryHeader: string | undefined,
    @Headers('x-yunqiao-accept-artifact-encoding') acceptedEncoding: string | undefined,
    @Res() response: Response,
  ) {
    const startedAt = Date.now();
    const retryCount = boundedRetryCount(retryHeader);
    const artifact = await this.jobs.binaryArtifact(
      terminal.merchantId,
      terminal.id,
      BigInt(params.id),
    );
    const encoding = acceptedEncoding === GZIP_ARTIFACT_ENCODING
      ? GZIP_ARTIFACT_ENCODING
      : 'identity';
    const wirePayload = encoding === GZIP_ARTIFACT_ENCODING
      ? await gzip(artifact.payload)
      : artifact.payload;
    let completed = false;
    this.logger.log(
      JSON.stringify({
        event: 'PRINT_ARTIFACT_DOWNLOAD_STARTED',
        jobId: artifact.jobId.toString(),
        terminalId: artifact.terminalId.toString(),
        bytes: artifact.byteLength,
        wireBytes: wirePayload.byteLength,
        encoding,
        durationMs: 0,
        shaStatus: 'PENDING',
        retryCount,
      }),
    );
    response.status(200);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', wirePayload.byteLength.toString());
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-YunQiao-Payload-SHA256', artifact.sha256);
    response.setHeader('X-YunQiao-Render-Protocol', artifact.renderProtocol);
    if (encoding === GZIP_ARTIFACT_ENCODING) {
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('X-YunQiao-Artifact-Encoding', GZIP_ARTIFACT_ENCODING);
      response.setHeader('X-YunQiao-Uncompressed-Length', artifact.byteLength.toString());
    }
    response.once('finish', () => {
      completed = true;
      this.logger.log(
        JSON.stringify({
          event: 'PRINT_ARTIFACT_DOWNLOAD_COMPLETED',
          jobId: artifact.jobId.toString(),
          terminalId: artifact.terminalId.toString(),
          bytes: artifact.byteLength,
          wireBytes: wirePayload.byteLength,
          encoding,
          durationMs: Date.now() - startedAt,
          shaStatus: 'MATCH',
          retryCount,
        }),
      );
    });
    response.once('close', () => {
      if (completed) return;
      this.logger.warn(
        JSON.stringify({
          event: 'PRINT_ARTIFACT_DOWNLOAD_FAILED',
          jobId: artifact.jobId.toString(),
          terminalId: artifact.terminalId.toString(),
          bytes: artifact.byteLength,
          wireBytes: wirePayload.byteLength,
          encoding,
          durationMs: Date.now() - startedAt,
          shaStatus: 'INCOMPLETE',
          retryCount,
        }),
      );
    });
    for (let offset = 0; offset < wirePayload.length; offset += 64 * 1024) {
      if (!response.write(wirePayload.subarray(offset, offset + 64 * 1024))) {
        await once(response, 'drain');
      }
    }
    response.end();
  }

  @Post('jobs/:id/artifact-failed')
  @UseGuards(ActiveTerminalGuard)
  artifactFailed(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: ReportArtifactFailureDto,
  ) {
    return this.jobs.recordBinaryArtifactFailure(
      terminal.merchantId,
      terminal.id,
      BigInt(params.id),
      dto.leaseVersion,
      dto.errorCode,
    );
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
      actualPayloadSha256: dto.actualPayloadSha256,
      transport: dto.transport,
      bytesWritten: dto.bytesWritten,
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
      actualPayloadSha256: dto.actualPayloadSha256,
      transport: dto.transport,
      bytesWritten: dto.bytesWritten,
    }).then((ack) => ({
      jobId: ack.jobId,
      status: ack.status,
    }));
  }

  @Post('jobs/:id/extend-lease')
  @UseGuards(ActiveTerminalGuard)
  async extendLease(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Param() params: IdParamDto,
    @Body() dto: ExtendPrintJobLeaseDto,
  ) {
    const job = await this.attempts.extendLease(
      terminal.merchantId,
      terminal.id,
      BigInt(params.id),
      dto.leaseVersion,
      dto.leaseMs,
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
    @Body() dto: ReportTerminalPrinterStatusDto,
  ) {
    return this.connector.reportPrinterStatus(terminal, dto);
  }
}

function boundedRetryCount(value: string | undefined) {
  if (!value || !/^[0-9]{1,2}$/.test(value)) return 0;
  return Math.min(20, Number(value));
}
