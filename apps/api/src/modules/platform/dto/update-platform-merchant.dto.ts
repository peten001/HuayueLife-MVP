import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
