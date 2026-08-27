import { IsString, Matches } from 'class-validator';
import { IsPositiveBigIntString } from '../../../common/validators/is-positive-bigint-string.validator';

export class TransferTableSessionDto {
  @IsPositiveBigIntString()
  targetTableId!: string;

  @IsPositiveBigIntString()
  expectedSourceTableId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  requestKey!: string;
}
