import { OrderType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class OrderRequestDto {
  @IsNumberString({ no_symbols: true })
  merchantId: string;

  @IsEnum(OrderType)
  orderType: OrderType;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/)
  tableToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deliveryAddress?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  @Min(-90)
  @Max(90)
  deliveryLatitude?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  @Min(-180)
  @Max(180)
  deliveryLongitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerRemark?: string;
}
