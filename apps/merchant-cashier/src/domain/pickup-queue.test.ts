import { describe, expect, it } from 'vitest';
import { matchesPickupFilter } from './pickup-queue';
import type { MerchantOrder } from '@/types';

const now = Date.parse('2026-10-19T11:45:00Z');
const row = (patch: Partial<MerchantOrder> = {}) => ({ orderType: 'PICKUP' as const, status: 'ACCEPTED' as const, isReservation: true, scheduledFor: '2026-10-19T12:00:00Z', ...patch });

describe('pickup queue stages', () => {
  it('shows confirmed pickup reservations in waiting preparation, and only started ones in making', () => {
    expect(matchesPickupFilter(row(), 'ACCEPTED', now)).toBe(true);
    expect(matchesPickupFilter(row(), 'PREPARING', now)).toBe(false);
    expect(matchesPickupFilter(row({ status: 'PREPARING' }), 'PREPARING', now)).toBe(true);
    expect(matchesPickupFilter(row({ isReservation: false }), 'PREPARING', now)).toBe(true);
    expect(matchesPickupFilter(row({ isReservation: false }), 'ACCEPTED', now)).toBe(false);
  });
  it('reminds only confirmed due or ASAP pickup reservations, using server time', () => {
    expect(matchesPickupFilter(row(), 'DUE', now)).toBe(true);
    expect(matchesPickupFilter(row({ scheduledFor: null }), 'DUE', now)).toBe(true);
    expect(matchesPickupFilter(row({ scheduledFor: '2026-10-19T14:00:00Z' }), 'DUE', now)).toBe(false);
    expect(matchesPickupFilter(row({ scheduledFor: 'invalid' }), 'DUE', now)).toBe(false);
    for (const status of ['PENDING_ACCEPTANCE', 'PREPARING', 'READY', 'CANCELLED'] as const) {
      expect(matchesPickupFilter(row({ status }), 'DUE', now)).toBe(false);
    }
  });
  it('never includes dining or delivery orders in pickup filters', () => {
    expect(matchesPickupFilter(row({ orderType: 'DINE_IN' }), 'ALL', now)).toBe(false);
    expect(matchesPickupFilter(row({ orderType: 'DELIVERY' }), 'DUE', now)).toBe(false);
  });
});
