import { ProductStatus } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional } from 'class-validator';

export class ListProductsQueryDto {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  categoryId?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
