import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePlatformMerchantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameZh: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  contactPhone: string;
}
