import { OrderType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CartContextQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  reservation?: boolean;

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
