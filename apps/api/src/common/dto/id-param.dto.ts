import { IsNumberString } from 'class-validator';

export class IdParamDto {
  @IsNumberString({ no_symbols: true })
  id: string;
}
