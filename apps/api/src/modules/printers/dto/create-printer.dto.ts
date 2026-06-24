import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsIP,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreatePrinterDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @Transform(({ value }) => trimString(value))
  @IsIP()
  ipAddress: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsIn([58, 80])
  paperWidth?: 58 | 80;

  @IsOptional()
  @IsIn(['FRONT_DESK', 'KITCHEN', 'BAR', 'GENERAL'])
  usageType?: 'FRONT_DESK' | 'KITCHEN' | 'BAR' | 'GENERAL';

  @IsOptional()
  @IsIn(['UTF8', 'GBK', 'CP1258'])
  encoding?: 'UTF8' | 'GBK' | 'CP1258';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  copies?: number;

  @IsOptional()
  @IsIn(['zh', 'vi', 'en'])
  language?: 'zh' | 'vi' | 'en';

  @IsOptional()
  @IsBoolean()
  autoPrintEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
