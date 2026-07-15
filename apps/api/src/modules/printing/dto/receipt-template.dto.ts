import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReceiptTemplateDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(['ORDER_CUSTOMER', 'TABLE_BILL'])
  receiptType: 'ORDER_CUSTOMER' | 'TABLE_BILL';

  @IsIn(['MM58', 'MM80'])
  paperWidth: 'MM58' | 'MM80';

  @IsIn(['MERCHANT_DEFAULT', 'ZH', 'VI', 'EN'])
  languageMode: 'MERCHANT_DEFAULT' | 'ZH' | 'VI' | 'EN';

  @IsObject()
  definition: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateReceiptTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['ORDER_CUSTOMER', 'TABLE_BILL'])
  receiptType?: 'ORDER_CUSTOMER' | 'TABLE_BILL';

  @IsOptional()
  @IsIn(['MM58', 'MM80'])
  paperWidth?: 'MM58' | 'MM80';

  @IsOptional()
  @IsIn(['MERCHANT_DEFAULT', 'ZH', 'VI', 'EN'])
  languageMode?: 'MERCHANT_DEFAULT' | 'ZH' | 'VI' | 'EN';

  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
