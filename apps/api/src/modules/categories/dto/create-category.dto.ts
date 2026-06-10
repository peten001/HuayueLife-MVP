import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(80)
  nameZh: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameVi?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
