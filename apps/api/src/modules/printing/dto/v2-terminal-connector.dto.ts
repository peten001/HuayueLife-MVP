import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class BootstrapV2TerminalDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  terminalInstanceId: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  terminalSecret: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  terminalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  deviceModel?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  appVersionCode?: number;

  @IsObject()
  capabilities: Record<string, unknown>;
}

export class SyncV2BindingDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  localBindingId: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedBindingVersion: number;

  @IsIn(['USB', 'LAN', 'BLUETOOTH'])
  transport: 'USB' | 'LAN' | 'BLUETOOTH';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName: string;

  @IsIn(['MM58', 'MM80'])
  paperWidth: 'MM58' | 'MM80';

  @IsObject()
  transportConfig: Record<string, unknown>;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  appVersionCode?: number;

  @IsIn(['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

export class V2RouteIdentityDto {
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

export class ArchiveV2BindingDto extends V2RouteIdentityDto {}

export class ReportV2PrinterStatusDto extends V2RouteIdentityDto {
  @IsIn(['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @IsIn(['PROBE', 'LOCAL_TEST', 'PRINT_RESULT'])
  source: 'PROBE' | 'LOCAL_TEST' | 'PRINT_RESULT';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  lastErrorCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  lastErrorMessage?: string;
}

export class ClaimV2PrintJobDto {
  @IsBoolean()
  allowAutomatic: boolean;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => V2RouteIdentityDto)
  routes: V2RouteIdentityDto[];
}

export class MarkV2PrintingDto extends V2RouteIdentityDto {
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

export class FinishV2PrintingDto extends V2RouteIdentityDto {
  @IsInt()
  @Min(1)
  attemptNo: number;

  @IsInt()
  @Min(0)
  leaseVersion: number;

  @IsOptional()
  @Transform(trim)
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

export class FailV2PrintingDto extends FinishV2PrintingDto {
  @IsBoolean()
  retryable: boolean;

  @IsIn(Object.values(PRINTING_ERROR_CODES))
  errorCode: (typeof PRINTING_ERROR_CODES)[keyof typeof PRINTING_ERROR_CODES];

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  errorMessage: string;

  @IsIn(['FAILED', 'UNCERTAIN'])
  outcome: 'FAILED' | 'UNCERTAIN';
}

export class ExtendV2PrintJobLeaseDto extends V2RouteIdentityDto {
  @IsInt()
  @Min(0)
  leaseVersion: number;

  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(120_000)
  leaseMs?: number;
}
