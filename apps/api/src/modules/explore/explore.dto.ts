import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { HOMEPAGE_CATEGORY_KEYS } from '../shared/homepage-category-keys';
import { EXPLORE_ICONS } from './explore-content';

export class ExploreCategoryDto {
  @Matches(/^[a-z][a-z0-9_-]{0,47}$/) code!: string;
  @IsString() @MaxLength(80) nameZh!: string;
  @IsOptional() @IsString() @MaxLength(80) nameVi?: string;
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsIn(EXPLORE_ICONS) iconKey!: typeof EXPLORE_ICONS[number];
  @IsInt() @Min(0) @Max(9999) sortOrder!: number;
  @IsBoolean() enabled!: boolean;
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) businessTypeCodes!: string[];
  @IsArray() @ArrayMaxSize(HOMEPAGE_CATEGORY_KEYS.length) @IsString({ each: true }) legacyKeys!: string[];
  @IsOptional() @IsBoolean() navigationOnly?: boolean;
}
export class ExploreTopicDto {
  @Matches(/^[a-z][a-z0-9_-]{0,47}$/) code!: string;
  @IsString() @MaxLength(80) nameZh!: string;
  @IsOptional() @IsString() @MaxLength(80) nameVi?: string;
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(120) subtitleZh?: string;
  @IsOptional() @IsString() @MaxLength(120) subtitleVi?: string;
  @IsOptional() @IsString() @MaxLength(120) subtitleEn?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsArray() @ArrayMaxSize(2) @IsIn(['北江', '北宁'], { each: true }) regions!: string[];
  @IsOptional() @Matches(/^[a-z][a-z0-9_-]{0,47}$|^$/) categoryCode?: string;
  @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,63}$|^$/) promotionTagCode?: string;
  @IsInt() @Min(0) @Max(9999) sortOrder!: number;
  @IsBoolean() enabled!: boolean;
}
export class ServiceItemDto {
  @IsString() @MaxLength(120) nameZh!: string;
  @IsOptional() @IsString() @MaxLength(120) nameVi?: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionZh?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionVi?: string;
  @IsOptional() @IsString() @MaxLength(500) descriptionEn?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1440) durationMinutes?: number | null;
  @IsIn(['INQUIRY', 'FIXED', 'FROM']) priceMode!: string;
  @IsOptional() @Matches(/^\d{1,12}$/) amountVnd?: string | null;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsInt() @Min(0) @Max(9999) sortOrder!: number;
  @IsBoolean() isVisible!: boolean;
}
