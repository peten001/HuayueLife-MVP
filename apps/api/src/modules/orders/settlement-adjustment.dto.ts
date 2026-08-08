import { IsBoolean, IsInt, Max, Min, ValidateIf } from 'class-validator';

export class SettlementAdjustmentDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountPayableRateBps!: number | null;

  @IsBoolean()
  roundingEnabled!: boolean;
}
