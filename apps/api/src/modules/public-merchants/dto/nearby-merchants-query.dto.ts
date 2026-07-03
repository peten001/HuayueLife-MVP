import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const PROVINCE_QUERY_VALUES = [
  '北江',
  '北宁',
  'Bac Giang',
  'Bac Ninh',
  'Bắc Giang',
  'Bắc Ninh',
  'BAC_GIANG',
  'BAC_NINH',
  'bac giang',
  'bac ninh',
  'bắc giang',
  'bắc ninh',
] as const;

export class NearbyMerchantsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(30)
  radiusKm = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @IsIn(PROVINCE_QUERY_VALUES)
  city?: string;

  @IsOptional()
  @IsIn(PROVINCE_QUERY_VALUES)
  province?: string;

  @IsOptional()
  @IsString()
  businessTypeId?: string;

  @IsOptional()
  @IsString()
  promotionTag?: string;
}
