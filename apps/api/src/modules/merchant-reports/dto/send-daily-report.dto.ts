import { IsIn, IsOptional, IsString } from 'class-validator';
import { DAILY_REPORT_LANGUAGES } from '../merchant-reports.constants';

export class SendDailyReportDto {
  @IsOptional()
  @IsString()
  @IsIn(DAILY_REPORT_LANGUAGES)
  language?: (typeof DAILY_REPORT_LANGUAGES)[number];
}

