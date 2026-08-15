import { IsOptional, IsString, Matches } from 'class-validator';

export class BusinessDaySummaryQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate?: string;
}

export class PrintBusinessDaySummaryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate!: string;

  @IsString()
  requestKey!: string;

  @IsOptional()
  @Matches(/^\d+$/)
  printerId?: string;
}
