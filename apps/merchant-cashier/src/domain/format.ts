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

export function formatItemPrice(value: string | number | bigint | null | undefined, locale: Locale = 'vi') {
  const numericValue = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  const amount = Number.isFinite(numericValue) ? numericValue : 0;
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(amount);
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

export function formatVietnamDateFilter(value: string, locale: Locale = 'vi') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, , month, day] = match;
  return locale === 'vi' ? `${day}/${month}` : `${month}/${day}`;
}

export function formatVietnamDateFilterAria(value: string, locale: Locale = 'vi') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  if (locale === 'zh') return `${year}年${Number(month)}月${Number(day)}日`;
  if (locale === 'vi') return `${day}/${month}/${year}`;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(Number(year), Number(month) - 1, Number(day), 12));
}
