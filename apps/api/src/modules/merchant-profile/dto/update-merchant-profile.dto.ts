import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { HOMEPAGE_CATEGORY_KEYS } from '../../shared/homepage-category-keys';

export class UpdateMerchantProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressDetail?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject({
    message: 'businessHours must be an object and cannot be null or an array',
  })
  businessHours?: Record<string, string[]>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notice?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt({
    message:
      'minimumDeliveryAmountVnd must be a non-negative integer and cannot be null or empty',
  })
  @Min(0)
  minimumDeliveryAmountVnd?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt({
    message:
      'deliveryFeeVnd must be a non-negative integer and cannot be null or empty',
  })
  @Min(0)
  deliveryFeeVnd?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message:
        'deliveryRadiusKm must be a number and cannot be null or empty',
    },
  )
  @Min(0)
  @Max(100)
  deliveryRadiusKm?: number;

  @IsOptional()
  @IsBoolean()
  dineInEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(HOMEPAGE_CATEGORY_KEYS, { each: true })
  homepageCategoryKeys?: string[];
}
