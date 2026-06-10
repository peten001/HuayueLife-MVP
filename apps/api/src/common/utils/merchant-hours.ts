import { Merchant } from '@prisma/client';

export function isMerchantOpen(merchant: Merchant, at = new Date()) {
  const schedule = merchant.businessHours as Record<string, string[]> | null;
  if (!schedule || typeof schedule !== 'object') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts
    .find((part) => part.type === 'weekday')
    ?.value.toLowerCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  const nowMinutes = hour * 60 + minute;

  return (
    (weekday ? schedule[weekday] : [])?.some((range) => {
      const [start, end] = range.split('-').map(toMinutes);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return end >= start
        ? nowMinutes >= start && nowMinutes <= end
        : nowMinutes >= start || nowMinutes <= end;
    }) ?? false
  );
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
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeOne)) *
      Math.cos(toRadians(latitudeTwo)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
