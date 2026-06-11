import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCategoryDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameZh: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameVi: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
