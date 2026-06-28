import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { HOMEPAGE_CATEGORY_KEYS } from '../../shared/homepage-category-keys';

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

  @IsOptional()
  @IsBoolean()
  isVisibleOnClient?: boolean;

  @IsOptional()
  @IsBoolean()
  reportFeatureEnabled?: boolean;
}
