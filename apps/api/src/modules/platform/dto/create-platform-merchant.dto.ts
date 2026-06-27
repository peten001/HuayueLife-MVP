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
