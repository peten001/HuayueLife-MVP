import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOrNull(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || null;
}

export class CreateMerchantSignatureDishDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameZh: string;

  @Transform(({ value }) => trimOrNull(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameVi?: string | null;

  @Transform(({ value }) => trimOrNull(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string | null;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  imageUrl: string;
}

export class UpdateMerchantSignatureDishDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameZh?: string;

  @Transform(({ value }) => trimOrNull(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameVi?: string | null;

  @Transform(({ value }) => trimOrNull(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string | null;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class MoveMerchantSignatureDishDto {
  @IsIn(['UP', 'DOWN'])
  direction: 'UP' | 'DOWN';
}
