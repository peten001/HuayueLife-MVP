import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class DecreaseOrderItemDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  requestKey: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  expectedQuantity: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  targetQuantity: number;
}
