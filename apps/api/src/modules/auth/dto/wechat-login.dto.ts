import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nickname?: string;
}
