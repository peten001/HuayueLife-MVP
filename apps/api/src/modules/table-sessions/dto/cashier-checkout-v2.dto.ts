import { IsOptional, IsString, Matches } from 'class-validator';
import { PaymentMethodDto } from '../../orders/payment-method.dto';

export class CashierCheckoutV2Dto extends PaymentMethodDto {
  @IsOptional()
  @IsString()
  @Matches(/^dcs2:sha256:[a-f0-9]{64}$/)
  expectedRevision?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  requestKey?: string;
}
