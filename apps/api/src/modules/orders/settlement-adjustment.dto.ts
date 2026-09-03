import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class SettlementAdjustmentDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountPayableRateBps!: number | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,18})$/)
  discountAmountVnd?: string;

  @IsBoolean()
  roundingEnabled!: boolean;
}
