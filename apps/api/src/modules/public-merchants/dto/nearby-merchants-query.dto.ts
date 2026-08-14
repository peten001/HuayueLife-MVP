import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HOMEPAGE_CATEGORY_KEYS,
  type HomepageCategoryKey,
} from '../../shared/homepage-category-keys';

/**
 * NOTE:
 * Bac Giang / Bac Ninh are BUSINESS REGIONS, not administrative provinces.
 * Public discovery accepts these legacy query names for compatibility, but the
 * values are interpreted only as operational-region filters.
 */
const OPERATIONAL_REGION_QUERY_VALUES = [
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

export const NEARBY_MERCHANT_SERVICE_FILTERS = [
  'OPEN',
  'DINE_IN',
  'PICKUP',
  'DELIVERY',
] as const;

export type NearbyMerchantServiceFilter =
  (typeof NEARBY_MERCHANT_SERVICE_FILTERS)[number];

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
  @IsIn(OPERATIONAL_REGION_QUERY_VALUES)
  city?: string;

  @IsOptional()
  @IsIn(OPERATIONAL_REGION_QUERY_VALUES)
  province?: string;

  @IsOptional()
  @IsString()
  businessTypeId?: string;

  @IsOptional()
  @IsString()
  promotionTag?: string;

  @IsOptional()
  @IsIn(HOMEPAGE_CATEGORY_KEYS)
  homepageCategoryKey?: HomepageCategoryKey;

  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeServiceFilters(value))
  @IsArray()
  @ArrayMaxSize(NEARBY_MERCHANT_SERVICE_FILTERS.length)
  @IsIn(NEARBY_MERCHANT_SERVICE_FILTERS, { each: true })
  serviceFilter?: NearbyMerchantServiceFilter[];
}

function normalizeServiceFilters(value: unknown) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)));
}
