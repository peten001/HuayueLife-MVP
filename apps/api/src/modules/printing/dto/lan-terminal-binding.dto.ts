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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SyncLanTerminalBindingDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  localBindingId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsIn(['MM58', 'MM80'])
  paperWidth: 'MM58' | 'MM80';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  appVersionCode?: number;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedBindingVersion: number;

  @IsBoolean()
  serviceRunning: boolean;

  @IsBoolean()
  executionEnabled: boolean;

  @IsIn(['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  lastError?: string;
}
