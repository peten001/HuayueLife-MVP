import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsNumberString({ no_symbols: true })
  categoryId: string;

  @IsString()
  @MaxLength(120)
  nameZh: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameVi?: string;

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
