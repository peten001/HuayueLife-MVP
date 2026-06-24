import { IsArray, IsNumberString, IsOptional } from 'class-validator';

export class PrintOrderDto {
  @IsOptional()
  @IsArray()
  @IsNumberString({ no_symbols: true }, { each: true })
  printerIds?: string[];
}
