import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const MERCHANT_MODES = ['DISPLAY', 'MANAGED', 'DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER'] as const;

export class UpsertBusinessTypeDto {
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  @MaxLength(64)
  code: string;

  @IsString()
  @MaxLength(80)
  nameZh: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  level?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(MERCHANT_MODES)
  defaultMerchantMode?: (typeof MERCHANT_MODES)[number];

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  defaultCapabilities?: Record<string, boolean>;
}

export class UpsertPromotionTagDto {
  @IsString()
  @MaxLength(64)
  code: string;

  @IsString()
  @MaxLength(80)
  nameZh: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  iconText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateCapabilitiesDto {
  @IsArray()
  items: Array<{ code: string; isEnabled: boolean }>;
}
