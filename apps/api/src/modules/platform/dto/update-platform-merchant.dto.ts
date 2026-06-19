import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const HOMEPAGE_CATEGORY_KEYS = ['chinese', 'noodles', 'drinks'] as const;

export class UpdatePlatformMerchantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameZh?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(HOMEPAGE_CATEGORY_KEYS, { each: true })
  homepageCategoryKeys?: string[];

  @IsOptional()
  @IsBoolean()
  manualPopular?: boolean;
}
