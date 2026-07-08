import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const MERCHANT_MODES = ['DISPLAY', 'MANAGED', 'DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER'] as const;
const MERCHANT_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED'] as const;

export class CreateDisplayMerchantDto {
  @IsString()
  @MaxLength(120)
  nameZh: string;

  @IsString()
  @MaxLength(120)
  nameVi: string;

  @IsString()
  @MaxLength(120)
  nameEn: string;

  @ValidateIf((_, value) => value !== undefined && value !== null && value !== '')
  @IsString()
  businessTypeId?: string;

  @IsOptional()
  @IsIn(MERCHANT_MODES)
  merchantMode?: (typeof MERCHANT_MODES)[number];

  @IsString()
  @MaxLength(32)
  contactPhone: string;

  @IsString()
  @MaxLength(64)
  contactName: string;

  @IsString()
  @MaxLength(80)
  province: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @IsString()
  @MaxLength(255)
  addressZh: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressEn?: string;

  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  openingHoursText?: string;

  @IsOptional()
  @IsObject({ message: 'businessHours must be an object' })
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  promotionTagIds?: string[];

  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisibleOnClient?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsIn(MERCHANT_STATUSES)
  status?: (typeof MERCHANT_STATUSES)[number];
}

export class UpdateMerchantCapabilitiesDto {
  @IsArray()
  items: Array<{ code: string; isEnabled: boolean }>;
}

export class UpdateMerchantTagsDto {
  @IsArray()
  promotionTagIds: string[];
}
