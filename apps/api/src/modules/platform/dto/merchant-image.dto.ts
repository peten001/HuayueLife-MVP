import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const IMAGE_TYPES = ['LOGO', 'COVER', 'STORE', 'ENVIRONMENT', 'PRODUCT', 'MENU', 'LICENSE'] as const;

export class CreateMerchantImageDto {
  @IsIn(IMAGE_TYPES)
  imageType: (typeof IMAGE_TYPES)[number];

  @IsString()
  @MaxLength(500)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleEn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class UpdateMerchantImageDto {
  @IsOptional()
  @IsIn(IMAGE_TYPES)
  imageType?: (typeof IMAGE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleEn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}
