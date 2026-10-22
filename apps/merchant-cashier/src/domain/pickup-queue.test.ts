import { describe, expect, it } from 'vitest';
import { matchesPickupFilter, PICKUP_FILTERS } from './pickup-queue';
import type { MerchantOrder } from '@/types';

const row = (patch: Partial<MerchantOrder> = {}) => ({ orderType: 'PICKUP' as const, status: 'ACCEPTED' as const, isReservation: true, ...patch });

describe('pickup queue stages', () => {
  it('uses the same making queue for ordinary and historical reservation pickups', () => {
    for (const isReservation of [true, false]) {
      expect(matchesPickupFilter(row({ isReservation }), 'PREPARING')).toBe(true);
      expect(matchesPickupFilter(row({ isReservation, status: 'PREPARING' }), 'PREPARING')).toBe(true);
      expect(matchesPickupFilter(row({ isReservation, status: 'PENDING_ACCEPTANCE' }), 'PREPARING')).toBe(false);
      expect(matchesPickupFilter(row({ isReservation, status: 'READY' }), 'READY')).toBe(true);
    }
    expect(PICKUP_FILTERS.map(filter => filter.value)).toEqual(['ALL', 'PENDING_ACCEPTANCE', 'PREPARING', 'READY']);
  });
  it('keeps scheduled legacy pickups in making regardless of time', () => {
    for (const scheduledFor of [null, '2026-10-19T14:00:00Z', '2027-12-30T12:00:00Z']) {
      expect(matchesPickupFilter(row({ scheduledFor }), 'PREPARING')).toBe(true);
    }
  });
  it('never includes dining or delivery orders in pickup filters', () => {
    expect(matchesPickupFilter(row({ orderType: 'DINE_IN' }), 'ALL')).toBe(false);
    expect(matchesPickupFilter(row({ orderType: 'DELIVERY' }), 'PREPARING')).toBe(false);
  });
});
