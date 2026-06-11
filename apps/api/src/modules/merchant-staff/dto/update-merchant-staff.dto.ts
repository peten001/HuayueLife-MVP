import { StaffRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateMerchantStaffDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  displayName?: string;

  @IsOptional()
  @IsEnum(StaffRole, {
    message: 'role must be MANAGER or STAFF',
  })
  role?: StaffRole;
}
