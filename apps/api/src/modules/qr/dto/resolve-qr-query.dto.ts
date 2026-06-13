import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class ResolveQrQueryDto {
  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/)
  token?: string;

  @IsOptional()
  @IsString()
  scene?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
