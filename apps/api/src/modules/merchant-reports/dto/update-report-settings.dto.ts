import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DAILY_REPORT_LANGUAGES } from '../merchant-reports.constants';

export class UpdateReportSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  zaloRecipient?: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  pushTime: string;

  @IsString()
  @IsIn(DAILY_REPORT_LANGUAGES)
  language: (typeof DAILY_REPORT_LANGUAGES)[number];

  @IsBoolean()
  aiSuggestions: boolean;
}

