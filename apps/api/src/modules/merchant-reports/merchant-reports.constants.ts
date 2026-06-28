export const DAILY_REPORT_LANGUAGES = ['zh', 'vi'] as const;

export type DailyReportLanguage = (typeof DAILY_REPORT_LANGUAGES)[number];

export const DEFAULT_DAILY_REPORT_PUSH_TIME = '22:00';

export const DAILY_REPORT_FEATURE_DISABLED_MESSAGE =
  'Daily report feature is not enabled for this merchant';

