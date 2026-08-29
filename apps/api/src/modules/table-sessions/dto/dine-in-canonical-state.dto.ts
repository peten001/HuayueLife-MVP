import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION = /^dcs2:sha256:[a-f0-9]{64}$/;

export class DineInCanonicalDesiredItemDto {
  @IsOptional()
  @IsString()
  @Matches(/^dline:sha256:[a-f0-9]{64}$/)
  lineKey?: string;

  @IsOptional()
  @IsPositiveBigIntString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  desiredQuantity!: number;
}

export class ReconcileDineInCanonicalStateDto {
  @IsString()
  @Matches(REQUEST_KEY)
  requestKey!: string;

  @IsString()
  @Matches(REVISION)
  baseRevision!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DineInCanonicalDesiredItemDto)
  desiredItems!: DineInCanonicalDesiredItemDto[];
}

export class ReleaseEmptyTableSessionDto {
  @IsString()
  @Matches(REQUEST_KEY)
  requestKey!: string;

  @IsString()
  @Matches(REVISION)
  expectedRevision!: string;
}
