import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
