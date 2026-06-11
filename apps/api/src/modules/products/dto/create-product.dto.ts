import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateProductDto {
  @IsNumberString({ no_symbols: true })
  categoryId: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  imageUrl?: string;

  @IsInt()
  @Min(0)
  priceVnd: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
