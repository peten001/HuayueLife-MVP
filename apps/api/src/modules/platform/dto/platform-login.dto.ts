import { IsString, MaxLength, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
