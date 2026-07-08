import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateMerchantAccountPhoneDto {
  @IsString()
  @MinLength(8)
  @MaxLength(15)
  @Matches(/^\d{8,15}$/, {
    message: 'phone must contain 8 to 15 digits',
  })
  phone: string;
}
