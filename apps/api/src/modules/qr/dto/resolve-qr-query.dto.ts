import { IsString, Length, Matches } from 'class-validator';

export class ResolveQrQueryDto {
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/)
  token: string;
}
