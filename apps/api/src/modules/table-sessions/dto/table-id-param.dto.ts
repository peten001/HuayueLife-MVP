import { IsNumberString } from 'class-validator';

export class TableIdParamDto {
  @IsNumberString({ no_symbols: true })
  tableId: string;
}
