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

export class CreatePlatformMerchantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(HOMEPAGE_CATEGORY_KEYS, { each: true })
  homepageCategoryKeys?: string[];

  @IsOptional()
  @IsBoolean()
  manualPopular?: boolean;
}
