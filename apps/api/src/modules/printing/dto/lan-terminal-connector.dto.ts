import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class LanRouteIdentityDto {
  @Matches(/^[1-9][0-9]{0,18}$/)
  printerId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  localBindingId: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  bindingVersion: number;
}

export class LanActiveJobQueryDto extends LanRouteIdentityDto {}

export class ClaimLanPrintJobDto extends LanRouteIdentityDto {
  @IsBoolean()
  allowAutomatic: boolean;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;
}

export class MarkLanPrintingDto extends LanRouteIdentityDto {
  @IsInt()
  @Min(0)
  leaseVersion: number;

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

export class FinishLanPrintingDto extends LanRouteIdentityDto {
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

export class FailLanPrintingDto extends FinishLanPrintingDto {
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

export class ExtendLanPrintJobLeaseDto extends LanRouteIdentityDto {
  @IsInt()
  @Min(0)
  leaseVersion: number;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;
}

export class ReportLanPrinterStatusDto extends LanRouteIdentityDto {
  @IsIn(['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @IsBoolean()
  serviceRunning: boolean;

  @IsBoolean()
  executionEnabled: boolean;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  lastError?: string;
}
