import { describe, expect, it } from 'vitest';
import { currentBusinessHoursRange, isWithinBusinessHours } from './merchant';

const schedule = {
  tuesday: ['10:00-22:00'],
};

describe('planned business-hours indicator', () => {
  it('uses the Asia/Ho_Chi_Minh business day', () => {
    expect(isWithinBusinessHours(schedule, new Date('2026-07-14T08:00:00.000Z'))).toBe(true);
    expect(isWithinBusinessHours(schedule, new Date('2026-07-14T16:00:00.000Z'))).toBe(false);
  });

  it('returns the configured range without inventing an open/closed switch', () => {
    expect(currentBusinessHoursRange(schedule, new Date('2026-07-14T08:00:00.000Z')))
      .toBe('10:00-22:00');
  });
});
