import { cashierConfig } from '@/config';

export function isWithinBusinessHours(
  schedule: Record<string, string[]> | null | undefined,
  at = new Date(),
) {
  if (!schedule || typeof schedule !== 'object') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: cashierConfig.vietnamTimeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts
    .find((part) => part.type === 'weekday')
    ?.value.toLocaleLowerCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const current = hour * 60 + minute;

  return Boolean(
    weekday &&
      schedule[weekday]?.some((range) => {
        const [start, end] = range.split('-').map(toMinutes);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return end >= start
          ? current >= start && current <= end
          : current >= start || current <= end;
      }),
  );
}

export function currentBusinessHoursRange(
  schedule: Record<string, string[]> | null | undefined,
  at = new Date(),
) {
  if (!schedule || typeof schedule !== 'object') return '';
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: cashierConfig.vietnamTimeZone,
    weekday: 'long',
  })
    .format(at)
    .toLocaleLowerCase();
  return schedule[weekday]?.join(' / ') ?? '';
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
