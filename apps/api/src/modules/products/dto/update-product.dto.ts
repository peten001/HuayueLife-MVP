import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOrNull(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || null;
}

export class UpdateProductDto {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  categoryId?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameZh: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameVi: string;

  @Transform(({ value }) => trimOrNull(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceVnd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
