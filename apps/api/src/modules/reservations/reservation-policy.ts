import { BadRequestException } from '@nestjs/common';

/** Availability is decided by staff. Only reject invalid or past timestamps. */
export function parseReservationTime(value: string, now = Date.now()): Date {
  const date = new Date(value);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(date.getTime()) || date.getTime() <= now) {
    throw new BadRequestException({ code: 'INVALID_RESERVATION_TIME', message: '请选择未来的预约时间（越南时间）' });
  }
  return date;
}

export function assertReservationKey(key: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw new BadRequestException('预约请求标识无效');
  }
}
