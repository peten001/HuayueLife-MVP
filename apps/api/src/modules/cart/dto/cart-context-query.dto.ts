import { OrderType } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CartContextQueryDto {
  @IsNumberString({ no_symbols: true })
  merchantId: string;

  @IsEnum(OrderType)
  orderType: OrderType;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/)
  tableToken?: string;
}
