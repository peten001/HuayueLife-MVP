import { describe, expect, it } from 'vitest';
import type { ArrivalReservation } from '@huayue-life/shared';
import { reservationMatchesFilter, reservationsByTable } from './reservation-queue';

const row = (patch: Partial<ArrivalReservation> = {}) => ({ id: '1', kind: 'DINE_IN', status: 'CONFIRMED', scheduledFor: '2026-10-20T12:00:00Z',
  assignedTable: { id: '6', tableNo: 'A6' }, ...patch } as ArrivalReservation);

describe('planned table reservations', () => {
  it('keeps only confirmed dine-in plans, in time order, independently of occupancy', () => {
    const result = reservationsByTable([
      row(), row({ id: '2', scheduledFor: '2026-10-20T10:00:00Z' }),
      row({ id: '3', kind: 'PICKUP' }), row({ id: '4', status: 'CANCELLED' }),
      row({ id: '5', status: 'SEATED' }), row({ id: '6', status: 'PENDING' }),
      row({ id: '7', assignedTable: null }), row({ id: '8', assignedTable: { id: null, tableNo: 'deleted' } }),
      row({ id: '9', status: 'NO_SHOW' }), row({ id: '10', status: 'COMPLETED' }),
    ]);
    expect(Object.keys(result)).toEqual(['6']);
    expect(result['6'].map(item => item.id)).toEqual(['2', '1']);
  });
  it('removes the old table hint after reassignment, cancellation or seating', () => {
    expect(reservationsByTable([row({ assignedTable: { id: '9', tableNo: 'B9' } })])['6']).toBeUndefined();
    expect(reservationsByTable([row({ status: 'CANCELLED' })])).toEqual({});
    expect(reservationsByTable([row({ status: 'SEATED' })])).toEqual({});
  });
  it('keeps seated parties active while completed, cancelled and no-show visits are history', () => {
    expect(reservationMatchesFilter(row({ status: 'SEATED' }), 'ACTIVE')).toBe(true);
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(reservationMatchesFilter(row({ status }), 'ACTIVE')).toBe(false);
      expect(reservationMatchesFilter(row({ status }), 'HISTORY')).toBe(true);
    }
    expect(reservationMatchesFilter(row({ status: 'PENDING' }), 'CONFIRMED')).toBe(false);
  });
});
