import { PaymentMethod } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class PaymentMethodDto {
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}
