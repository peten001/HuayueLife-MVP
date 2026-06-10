import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @MaxLength(32)
  tableNo: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableName?: string;
}
