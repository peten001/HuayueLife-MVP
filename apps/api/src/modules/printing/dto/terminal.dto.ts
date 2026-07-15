import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
}
