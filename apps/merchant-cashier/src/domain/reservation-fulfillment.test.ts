import { describe, expect, it } from 'vitest';
import { formatReservationTime, reservationTimestamp, reservationText, vietnamDateTimeParts } from '@huayue-life/shared';
import { fulfillmentActionSequence, nextFulfillmentAction } from './fulfillment';

describe('reservation fulfillment and local time', () => {
  it('accepting a historical reservation pickup follows the ordinary preparation shortcut', () => {
    expect(fulfillmentActionSequence({ orderType: 'PICKUP', status: 'PENDING_ACCEPTANCE', isReservation: true }, 'accept')).toEqual(['accept', 'start-preparing']);
    expect(nextFulfillmentAction({ orderType: 'PICKUP', status: 'ACCEPTED', isReservation: true })).toBe('finish-preparing');
    expect(fulfillmentActionSequence({ orderType: 'PICKUP', status: 'ACCEPTED', isReservation: true }, 'start-preparing')).toEqual(['start-preparing']);
    expect(fulfillmentActionSequence({ orderType: 'PICKUP', status: 'PREPARING', isReservation: true }, 'finish-preparing')).toEqual(['ready']);
  });
  it('preserves the ordinary pickup and delivery shortcut', () => {
    for (const orderType of ['PICKUP', 'DELIVERY'] as const) {
      expect(fulfillmentActionSequence({ orderType, status: 'PENDING_ACCEPTANCE' }, 'accept')).toEqual(['accept', 'start-preparing']);
    }
  });
  it('always converts local booking time using Vietnam time independently of device timezone', () => {
    expect(reservationTimestamp('2026-10-20', '00:15')).toBe('2026-10-19T17:15:00.000Z');
    expect(formatReservationTime('2026-10-19T17:15:00Z')).toBe('2026-10-20 00:15');
    expect(vietnamDateTimeParts(Date.parse('2026-10-19T23:00:00Z'))).toEqual({ date: '2026-10-20', time: '06:00' });
  });
  it.each(['zh', 'en', 'vi'])('has complete state labels and distinct dining and pickup labels in %s', locale => {
    expect(reservationText('pickup', locale)).not.toBe(reservationText('dineIn', locale));
    for (const status of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SEATED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'] as const) {
      expect(reservationText(status, locale)).toBeTruthy();
    }
    expect(formatReservationTime(null, locale)).toBe(reservationText('asap', locale));
  });
});
