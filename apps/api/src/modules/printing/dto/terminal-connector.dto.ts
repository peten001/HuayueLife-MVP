import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class TerminalHeartbeatDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  heartbeatSeq?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  appliedConfigVersion?: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  buildRevision?: string;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  diagnostics?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastErrorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastErrorMessage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsNumberString({ no_symbols: true }, { each: true })
  activeJobIds?: string[];
}

export class ClaimPrintJobDto {
  @IsBoolean()
  allowAutomatic: boolean;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  printerId?: string;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;
}

export class MarkPrintingDto {
  @IsInt()
  @Min(0)
  leaseVersion: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  adapter: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contentHash: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  @IsOptional()
  @IsObject()
  networkInfo?: Record<string, unknown>;
}

export class FinishPrintingDto {
  @IsInt()
  @Min(1)
  attemptNo: number;

  @IsInt()
  @Min(0)
  leaseVersion: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  printerResponse?: string;

  @IsInt()
  @Min(0)
  @Max(20_000_000)
  bytesWritten: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contentHash: string;
}

export class FailPrintingDto extends FinishPrintingDto {
  @IsBoolean()
  retryable: boolean;

  @IsIn(Object.values(PRINTING_ERROR_CODES))
  errorCode: (typeof PRINTING_ERROR_CODES)[keyof typeof PRINTING_ERROR_CODES];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  errorMessage: string;

  @IsIn(['FAILED', 'UNCERTAIN'])
  outcome: 'FAILED' | 'UNCERTAIN';
}

export class ExtendPrintJobLeaseDto {
  @IsInt()
  @Min(0)
  leaseVersion: number;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;
}

export class ReportTerminalPrinterStatusDto {
  @IsNumberString({ no_symbols: true })
  printerId: string;

  @IsIn(['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastErrorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastErrorMessage?: string;
}

export class UpdateMerchantPrintingSettingsDto {
  @IsBoolean()
  printingEnabled: boolean;
}
