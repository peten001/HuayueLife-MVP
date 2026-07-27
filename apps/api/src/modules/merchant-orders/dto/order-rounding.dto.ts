import { IsBoolean } from 'class-validator';

export class OrderRoundingDto {
  @IsBoolean()
  enabled!: boolean;
}
