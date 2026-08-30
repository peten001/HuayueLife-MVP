import { Merchant } from '@prisma/client';

export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const BUSINESS_TIME_ZONE_OFFSET_MINUTES = 7 * 60;
export const BUSINESS_WEEKDAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

export type BusinessWeekday = (typeof BUSINESS_WEEKDAYS)[number];
export type BusinessHoursSchedule = Record<BusinessWeekday, string[]>;

export interface BusinessInterval {
  businessDate: string;
  weekday: BusinessWeekday;
  range: string;
  start: Date;
  end: Date;
  crossesMidnight: boolean;
}

export interface BusinessDayWindow {
  businessDate: string;
  segments: BusinessInterval[];
  start: Date;
  end: Date;
}

// 24:00 is valid only as the exclusive end of a business interval. This keeps
// the established all-day 00:00-24:00 profile contract without admitting
// invalid starts such as 24:00-02:00 or values beyond the day boundary.
const TIME_RANGE = /^(?:[01]\d|2[0-3]):[0-5]\d-(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize historical single-range and segment-object shapes at one boundary. */
export function normalizeBusinessHours(value: unknown): BusinessHoursSchedule {
  const result = Object.fromEntries(
    BUSINESS_WEEKDAYS.map((weekday) => [weekday, []]),
  ) as unknown as BusinessHoursSchedule;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  for (const weekday of BUSINESS_WEEKDAYS) {
    const rawSegments = rawDaySegments((value as Record<string, unknown>)[weekday]);
    result[weekday] = rawSegments
      .map(normalizeRange)
      .filter((range): range is string => Boolean(range));
  }
  return result;
}

export function validateBusinessHoursSchedule(value: unknown): BusinessHoursSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('businessHours must be an object');
  }
  const suppliedKeys = Object.keys(value as Record<string, unknown>);
  if (suppliedKeys.some((key) => !BUSINESS_WEEKDAYS.includes(key as BusinessWeekday))) {
    throw new Error('businessHours contains an unsupported weekday');
  }

  const normalized = normalizeBusinessHours(value);
  const weekly: Array<{ id: string; start: number; end: number }> = [];
  BUSINESS_WEEKDAYS.forEach((weekday, weekdayIndex) => {
    const rawSegments = rawDaySegments((value as Record<string, unknown>)[weekday]);
    if (normalized[weekday].length !== rawSegments.length) {
      throw new Error('businessHours interval must use HH:mm-HH:mm');
    }
    normalized[weekday].forEach((range, rangeIndex) => {
      const [start, end] = range.split('-').map(timeToMinutes);
      if (start === end) {
        throw new Error('businessHours interval start and end cannot be equal');
      }
      weekly.push({
        id: `${weekday}:${rangeIndex}`,
        start: weekdayIndex * 1440 + start,
        end: weekdayIndex * 1440 + end + (end < start ? 1440 : 0),
      });
    });
  });

  for (const interval of weekly) {
    for (const other of weekly) {
      if (interval.id === other.id) continue;
      for (const weekOffset of [-10080, 0, 10080]) {
        const otherStart = other.start + weekOffset;
        const otherEnd = other.end + weekOffset;
        if (Math.max(interval.start, otherStart) < Math.min(interval.end, otherEnd)) {
          throw new Error('businessHours intervals cannot overlap, including adjacent weekdays');
        }
      }
    }
  }
  return normalized;
}

export function businessIntervalsForDate(
  scheduleValue: unknown,
  businessDate: string,
): BusinessInterval[] {
  assertBusinessDate(businessDate);
  const schedule = normalizeBusinessHours(scheduleValue);
  const weekday = weekdayForBusinessDate(businessDate);
  return schedule[weekday]
    .map((range) => {
      const [startMinutes, endMinutes] = range.split('-').map(timeToMinutes);
      if (startMinutes === endMinutes) return null;
      const crossesMidnight = endMinutes < startMinutes;
      return {
        businessDate,
        weekday,
        range,
        start: instantForBusinessDateMinute(businessDate, startMinutes),
        end: instantForBusinessDateMinute(
          crossesMidnight ? addBusinessDays(businessDate, 1) : businessDate,
          endMinutes,
        ),
        crossesMidnight,
      } satisfies BusinessInterval;
    })
    .filter((interval): interval is BusinessInterval => Boolean(interval))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

export function businessDayWindow(
  scheduleValue: unknown,
  businessDate: string,
): BusinessDayWindow | null {
  const segments = businessIntervalsForDate(scheduleValue, businessDate);
  if (!segments.length) return null;
  return {
    businessDate,
    segments,
    start: segments[0].start,
    end: segments.reduce(
      (latest, segment) => segment.end > latest ? segment.end : latest,
      segments[0].end,
    ),
  };
}

export function resolveBusinessDate(scheduleValue: unknown, at = new Date()): string {
  const naturalDate = localBusinessDate(at);
  const previousDate = addBusinessDays(naturalDate, -1);
  const previousWindow = businessDayWindow(scheduleValue, previousDate);
  if (previousWindow && containsInstant(previousWindow.start, previousWindow.end, at)) {
    return previousDate;
  }
  const currentWindow = businessDayWindow(scheduleValue, naturalDate);
  if (currentWindow && containsInstant(currentWindow.start, currentWindow.end, at)) {
    return naturalDate;
  }
  return naturalDate;
}

export function isInstantInBusinessDate(
  scheduleValue: unknown,
  businessDate: string,
  at: Date,
): boolean {
  const window = businessDayWindow(scheduleValue, businessDate);
  return Boolean(window && containsInstant(window.start, window.end, at));
}

export function isMerchantOpen(
  merchant: Pick<Merchant, 'businessHours'>,
  at = new Date(),
) {
  const naturalDate = localBusinessDate(at);
  return [addBusinessDays(naturalDate, -1), naturalDate].some((businessDate) =>
    businessIntervalsForDate(merchant.businessHours, businessDate)
      .some((segment) => containsInstant(segment.start, segment.end, at)),
  );
}

export function localBusinessDate(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addBusinessDays(businessDate: string, days: number): string {
  assertBusinessDate(businessDate);
  const [year, month, day] = businessDate.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-');
}

export function instantForBusinessDateMinute(businessDate: string, minuteOfDay: number) {
  assertBusinessDate(businessDate);
  const [year, month, day] = businessDate.split('-').map(Number);
  return new Date(Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minuteOfDay / 60) - Math.floor(BUSINESS_TIME_ZONE_OFFSET_MINUTES / 60),
    minuteOfDay % 60,
  ));
}

export function assertBusinessDate(value: string) {
  if (!BUSINESS_DATE.test(value)) throw new Error('businessDate must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) throw new Error('businessDate is not a valid calendar date');
}

export function distanceKm(
  latitudeOne: number,
  longitudeOne: number,
  latitudeTwo: number,
  longitudeTwo: number,
) {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(latitudeTwo - latitudeOne);
  const longitudeDelta = toRadians(longitudeTwo - longitudeOne);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeOne)) * Math.cos(toRadians(latitudeTwo)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rawDaySegments(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const day = value as Record<string, unknown>;
  if (Array.isArray(day.segments)) return day.segments;
  const start = day.openTime ?? day.start;
  const end = day.closeTime ?? day.end;
  return typeof start === 'string' && typeof end === 'string'
    ? [`${start}-${end}`]
    : [];
}

function normalizeRange(value: unknown): string | null {
  if (typeof value === 'string' && TIME_RANGE.test(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const start = (value as Record<string, unknown>).start;
  const end = (value as Record<string, unknown>).end;
  return typeof start === 'string' && typeof end === 'string' &&
    TIME_RANGE.test(`${start}-${end}`) ? `${start}-${end}` : null;
}

function weekdayForBusinessDate(businessDate: string): BusinessWeekday {
  const [year, month, day] = businessDate.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return BUSINESS_WEEKDAYS[(utcDay + 6) % 7];
}

function containsInstant(start: Date, end: Date, at: Date) {
  return at.getTime() >= start.getTime() && at.getTime() < end.getTime();
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
