import { Type } from 'class-transformer';
import { IsDateString, IsNumberString, IsOptional, Matches } from 'class-validator';

export class PlatformAnalyticsQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @IsOptional()
  city?: string;

  @IsOptional()
  @Type(() => String)
  @IsNumberString({ no_symbols: true })
  merchantId?: string;
}
