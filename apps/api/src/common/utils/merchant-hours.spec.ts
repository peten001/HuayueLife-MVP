import { isMerchantOpen } from './merchant-hours';

const merchant = {
  businessHours: {
    sunday: ['09:00-12:00', '17:00-22:00'],
    monday: [],
  },
} as never;

describe('isMerchantOpen', () => {
  it('treats any matching Vietnam-time interval as open and the lunch gap as closed', () => {
    expect(isMerchantOpen(merchant, new Date('2026-08-02T03:00:00.000Z'))).toBe(true);
    expect(isMerchantOpen(merchant, new Date('2026-08-02T06:00:00.000Z'))).toBe(false);
    expect(isMerchantOpen(merchant, new Date('2026-08-02T11:00:00.000Z'))).toBe(true);
  });

  it('treats a closed weekday as closed', () => {
    expect(isMerchantOpen(merchant, new Date('2026-08-03T03:00:00.000Z'))).toBe(false);
  });
});
