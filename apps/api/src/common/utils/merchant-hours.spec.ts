import {
  businessDayWindow,
  isInstantInBusinessDate,
  isMerchantOpen,
  normalizeBusinessHours,
  resolveBusinessDate,
  validateBusinessHoursSchedule,
} from './merchant-hours';

describe('canonical merchant business day', () => {
  const singleCrossMidnight = { saturday: ['15:00-03:00'] };

  it('assigns a single cross-midnight interval with an exclusive end', () => {
    expect(isInstantInBusinessDate(singleCrossMidnight, '2026-08-15', new Date('2026-08-15T09:00:00Z'))).toBe(true);
    expect(isInstantInBusinessDate(singleCrossMidnight, '2026-08-15', new Date('2026-08-15T16:30:00Z'))).toBe(true);
    expect(isInstantInBusinessDate(singleCrossMidnight, '2026-08-15', new Date('2026-08-15T19:30:00Z'))).toBe(true);
    expect(isInstantInBusinessDate(singleCrossMidnight, '2026-08-15', new Date('2026-08-15T20:00:00Z'))).toBe(false);
  });

  it('uses earliest start through latest end for accounting but not open status', () => {
    const schedule = { saturday: ['11:00-14:00', '16:00-01:00'] };
    const merchant = { businessHours: schedule } as never;
    const window = businessDayWindow(schedule, '2026-08-15');
    expect(window?.start.toISOString()).toBe('2026-08-15T04:00:00.000Z');
    expect(window?.end.toISOString()).toBe('2026-08-15T18:00:00.000Z');
    expect(isInstantInBusinessDate(schedule, '2026-08-15', new Date('2026-08-15T08:00:00Z'))).toBe(true);
    expect(isMerchantOpen(merchant, new Date('2026-08-15T08:00:00Z'))).toBe(false);
    expect(isMerchantOpen(merchant, new Date('2026-08-15T17:30:00Z'))).toBe(true);
    expect(isInstantInBusinessDate(schedule, '2026-08-15', new Date('2026-08-15T18:00:00Z'))).toBe(false);
  });

  it('resolves the current Business Date from the previous cross-midnight window', () => {
    expect(resolveBusinessDate(singleCrossMidnight, new Date('2026-08-15T19:00:00Z'))).toBe('2026-08-15');
    expect(resolveBusinessDate(singleCrossMidnight, new Date('2026-08-15T20:00:00Z'))).toBe('2026-08-16');
  });

  it('rejects same-day and adjacent-weekday overlap but permits touching boundaries', () => {
    expect(() => validateBusinessHoursSchedule({ monday: ['16:00-01:00'], tuesday: ['00:30-03:00'] })).toThrow(/overlap/);
    expect(() => validateBusinessHoursSchedule({ monday: ['11:00-14:00', '13:30-16:00'] })).toThrow(/overlap/);
    expect(validateBusinessHoursSchedule({ monday: ['16:00-01:00'], tuesday: ['01:00-03:00'] }).tuesday).toEqual(['01:00-03:00']);
  });

  it('rejects start equals end and supports legacy day objects', () => {
    expect(() => validateBusinessHoursSchedule({ monday: ['10:00-10:00'] })).toThrow(/equal/);
    expect(normalizeBusinessHours({ monday: { openTime: '09:00', closeTime: '17:00' } }).monday).toEqual(['09:00-17:00']);
    expect(normalizeBusinessHours({ tuesday: { segments: [{ start: '10:00', end: '13:00' }] } }).tuesday).toEqual(['10:00-13:00']);
  });

  it('assigns by createdAt: 00:50-created orders stay on the previous business day even if completed at 01:10', () => {
    const schedule = { saturday: ['15:00-01:00'] };
    const createdAt = new Date('2026-08-15T17:50:00.000Z'); // 8/16 00:50 local
    const completedAt = new Date('2026-08-15T18:10:00.000Z'); // 8/16 01:10 local

    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-15');
    expect(resolveBusinessDate(schedule, completedAt)).toBe('2026-08-16');
    expect(isInstantInBusinessDate(schedule, '2026-08-15', createdAt)).toBe(true);
  });

  it('assigns a 01:25-created order to the natural/current business day', () => {
    const schedule = { saturday: ['15:00-01:00'] };
    const createdAt = new Date('2026-08-15T18:25:00.000Z'); // 8/16 01:25 local
    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-16');
  });

  it('assigns a 00:40-created order to the previous day under multi-segment hours', () => {
    const schedule = { saturday: ['11:00-14:00', '16:00-01:00'] };
    const createdAt = new Date('2026-08-15T17:40:00.000Z'); // 8/16 00:40 local
    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-15');
  });

  it('assigns a gap-period 14:30-created order to the natural creation day', () => {
    const schedule = { saturday: ['11:00-14:00', '16:00-01:00'] };
    const createdAt = new Date('2026-08-15T07:30:00.000Z'); // 8/15 14:30 local
    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-15');
  });

  it('assigns a 01:25-created order to the previous business day when hours close at 02:00', () => {
    // Production 地锅居 confirmation: 17:00-02:00, order 606 created 8/15 01:25.
    const schedule = { friday: ['17:00-02:00'], saturday: ['17:00-02:00'] };
    const createdAt = new Date('2026-08-14T18:25:00.000Z'); // 8/15 01:25 local
    const completedAt = new Date('2026-08-14T18:26:00.000Z'); // 8/15 01:26 local
    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-14');
    expect(resolveBusinessDate(schedule, completedAt)).toBe('2026-08-14');
  });

  it('excludes the exact 02:00 closing instant from the previous business day', () => {
    const schedule = { friday: ['17:00-02:00'], saturday: ['17:00-02:00'] };
    const createdAt = new Date('2026-08-14T19:00:00.000Z'); // 8/15 02:00 local exactly
    expect(resolveBusinessDate(schedule, createdAt)).not.toBe('2026-08-14');
    expect(resolveBusinessDate(schedule, createdAt)).toBe('2026-08-15');
  });
});
