import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePrintRuleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsIn(['DINE_IN', 'PICKUP', 'DELIVERY'])
  orderType?: 'DINE_IN' | 'PICKUP' | 'DELIVERY';

  @IsIn(['ORDER_ACCEPTED', 'ORDER_COMPLETED', 'MANUAL'])
  triggerEvent: 'ORDER_ACCEPTED' | 'ORDER_COMPLETED' | 'MANUAL';

  @IsIn(['ORDER_CUSTOMER', 'TABLE_BILL'])
  receiptType: 'ORDER_CUSTOMER' | 'TABLE_BILL';

  @IsNumberString({ no_symbols: true })
  printerId: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  receiptTemplateId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  copies?: number;

  @IsOptional()
  @IsBoolean()
  autoPrint?: boolean;

  // Accepted for client compatibility but intentionally ignored by create;
  // rules can only be enabled through the guarded /enable action.
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}

export class UpdatePrintRuleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['DINE_IN', 'PICKUP', 'DELIVERY'])
  orderType?: 'DINE_IN' | 'PICKUP' | 'DELIVERY' | null;

  @IsOptional()
  @IsIn(['ORDER_ACCEPTED', 'ORDER_COMPLETED', 'MANUAL'])
  triggerEvent?: 'ORDER_ACCEPTED' | 'ORDER_COMPLETED' | 'MANUAL';

  @IsOptional()
  @IsIn(['ORDER_CUSTOMER', 'TABLE_BILL'])
  receiptType?: 'ORDER_CUSTOMER' | 'TABLE_BILL';

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  printerId?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  receiptTemplateId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  copies?: number;

  @IsOptional()
  @IsBoolean()
  autoPrint?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}
