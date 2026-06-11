import { OrderStatus, OrderType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, Matches } from 'class-validator';

export class ListMerchantOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
