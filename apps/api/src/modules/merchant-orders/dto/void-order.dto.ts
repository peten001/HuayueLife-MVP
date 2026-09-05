import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class VoidOrderDto {
  @IsIn(['MISTAKE', 'DUPLICATE', 'TEST', 'OTHER'])
  reason!: 'MISTAKE' | 'DUPLICATE' | 'TEST' | 'OTHER';

  @IsOptional() @IsString() @MaxLength(255)
  note?: string;

  @IsUUID('4')
  requestKey!: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  version!: string;
}

export class ListOrderVoidsDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional() @IsString() @MaxLength(64)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}
