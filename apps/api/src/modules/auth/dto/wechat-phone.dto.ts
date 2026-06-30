import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WechatPhoneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  encryptedData?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  iv?: string;
}
