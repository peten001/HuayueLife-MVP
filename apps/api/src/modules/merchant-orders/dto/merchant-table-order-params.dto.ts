import { IsPositiveBigIntString } from '../../../common/validators/is-positive-bigint-string.validator';

export class MerchantTableOrderParamsDto {
  @IsPositiveBigIntString()
  tableId: string;
}
