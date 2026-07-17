import { IsPositiveBigIntString } from '../../../common/validators/is-positive-bigint-string.validator';

export class OrderItemParamsDto {
  @IsPositiveBigIntString()
  orderId: string;

  @IsPositiveBigIntString()
  itemId: string;
}
