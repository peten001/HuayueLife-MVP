import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TableStatus } from '@prisma/client';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  tableNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableName?: string;

  @IsOptional()
  @IsEnum(TableStatus)
  status?: TableStatus;
}
