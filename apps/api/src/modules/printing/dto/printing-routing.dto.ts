import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class PrintingRoutingPrinterDto {
  @IsNumberString({ no_symbols: true })
  printerId: string;

  @IsBoolean()
  newOrderAutoPrint: boolean;

  @IsOptional()
  @IsArray()
  @IsNumberString({ no_symbols: true }, { each: true })
  categoryIds?: string[];
}

export class UpdatePrintingRoutingDto {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  checkoutDefaultPrinterId?: string | null;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  defaultKitchenPrinterId?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintingRoutingPrinterDto)
  printers: PrintingRoutingPrinterDto[];
}
