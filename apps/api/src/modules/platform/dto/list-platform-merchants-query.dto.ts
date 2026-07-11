import { MerchantClaimStatus, MerchantMode } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListPlatformMerchantsQueryDto {
  @IsOptional()
  @IsEnum(MerchantClaimStatus)
  claimStatus?: MerchantClaimStatus;

  @IsOptional()
  @IsEnum(MerchantMode)
  merchantMode?: MerchantMode;
}
