import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListPrintJobsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'CLAIMED', 'PRINTING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsIn(['AUTOMATIC', 'MANUAL_REPRINT', 'TEST'])
  source?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  printerId?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  orderId?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PrintJobActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
