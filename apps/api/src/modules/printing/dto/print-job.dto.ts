import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Matches,
  Min,
} from 'class-validator';

export class ListPrintJobsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'CLAIMED', 'PRINTING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsIn(['AUTOMATIC', 'MANUAL', 'MANUAL_REPRINT', 'TEST'])
  source?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  printerId?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  orderId?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  tableSessionId?: string;

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

export class CreateManualOrderPrintJobDto {
  @IsNumberString({ no_symbols: true })
  orderId: string;

  @IsNumberString({ no_symbols: true })
  printerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestKey: string;
}

export class CreateManualTableBillPrintJobDto {
  @IsNumberString({ no_symbols: true })
  tableSessionId: string;

  @IsNumberString({ no_symbols: true })
  printerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestKey: string;
}

export class CreateManualReprintJobDto {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  printerId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestKey: string;
}

export class CreatePrinterTestJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestKey: string;
}
