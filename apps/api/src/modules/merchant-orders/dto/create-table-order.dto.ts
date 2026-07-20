import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsPositiveBigIntString } from '../../../common/validators/is-positive-bigint-string.validator';

export class CreateTableOrderItemDto {
  @IsPositiveBigIntString()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

export class CreateTableOrderDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateTableOrderItemDto)
  items: CreateTableOrderItemDto[];
}
