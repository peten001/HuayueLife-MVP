import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateDiningReservationDto {
  @IsNumberString({ no_symbols: true })
  merchantId: string;

  @IsISO8601({ strict: true })
  scheduledFor: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  guestCount: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/\S/)
  contactName: string;

  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{5,30}[0-9]$/)
  contactPhone: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerRemark?: string;

  @IsOptional()
  @IsBoolean()
  withCart?: boolean;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  expectedAmountVnd?: string;
}

export class ReservationParamsDto {
  @IsIn(['DINE_IN', 'PICKUP'])
  kind: 'DINE_IN' | 'PICKUP';

  @IsNumberString({ no_symbols: true })
  id: string;
}

export class AddReservationDishesDto {
  @IsNumberString({ no_symbols: true })
  cartId: string;

  @IsNumberString({ no_symbols: true })
  expectedAmountVnd: string;
}

export class ReservationActionDto {
  @IsIn(['CONFIRM', 'CANCEL', 'NO_SHOW', 'SEAT', 'PROPOSE_TIME', 'ASSIGN_TABLE'])
  action: 'CONFIRM' | 'CANCEL' | 'NO_SHOW' | 'SEAT' | 'PROPOSE_TIME' | 'ASSIGN_TABLE';

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  tableId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class ReservationTimeReplyDto {
  @IsBoolean()
  accept: boolean;

  @IsISO8601({ strict: true })
  proposedScheduledFor: string;
}
