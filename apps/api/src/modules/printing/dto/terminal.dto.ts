import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMerchantTerminalDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(['ANDROID', 'WEB', 'SERVER'])
  platform: 'ANDROID' | 'WEB' | 'SERVER';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  boundPrinterId?: string;
}

export class UpdateMerchantTerminalDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['ANDROID', 'WEB', 'SERVER'])
  platform?: 'ANDROID' | 'WEB' | 'SERVER';

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsNumberString({ no_symbols: true })
  boundPrinterId?: string | null;
}

export class GenerateTerminalPairingCodeDto {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10)
  expiresInMinutes?: number;
}

export class PairTerminalDto {
  @IsString()
  @Matches(/^[0-9a-f-]{36}$/i)
  pairingId: string;

  @IsString()
  @Matches(/^\d{8}$/)
  pairingCode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  deviceIdentifier: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsIn(['ANDROID'])
  platform: 'ANDROID';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}
