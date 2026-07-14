import { cashierConfig } from '@/config';
import type { Locale } from '@/i18n';

const localeTags: Record<Locale, string> = {
  zh: 'zh-CN',
  vi: 'vi-VN',
  en: 'en-US',
};

export function formatVnd(value: string | number | bigint | null | undefined, locale: Locale = 'vi') {
  const numericValue = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  const amount = Number.isFinite(numericValue) ? numericValue : 0;
  return locale === 'vi'
    ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)} ₫`
    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)} VND`;
}

export function formatVietnamDateTime(
  value: string | Date | null | undefined,
  locale: Locale = 'vi',
) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeZone: cashierConfig.vietnamTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatVietnamTime(
  value: string | Date | null | undefined,
  locale: Locale = 'vi',
) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeZone: cashierConfig.vietnamTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function todayInVietnam(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: cashierConfig.vietnamTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
