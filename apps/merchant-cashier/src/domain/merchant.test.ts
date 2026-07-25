import { describe, expect, it } from 'vitest';
import {
  cashierWorkspaceEnabled,
  currentBusinessHoursRange,
  firstEnabledCashierWorkspace,
  isWithinBusinessHours,
  resolveCashierWorkspaceCapabilities,
} from './merchant';

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

describe('cashier workspace capabilities', () => {
  it('uses authenticated session capabilities when the profile request fails', () => {
    const capabilities = resolveCashierWorkspaceCapabilities(null, {
      id: 'merchant-1',
      nameZh: 'Merchant',
      status: 'ACTIVE',
      capabilities: [
        { code: 'qrOrderEnabled', isEnabled: true },
        { code: 'pickupEnabled', isEnabled: false },
        { code: 'deliveryEnabled', isEnabled: true },
      ],
    });

    expect(capabilities).toEqual({ tables: true, pickup: false, delivery: true });
    expect(cashierWorkspaceEnabled('pickup-orders', capabilities)).toBe(false);
    expect(firstEnabledCashierWorkspace(capabilities)).toBe('tables');
  });

  it('fails closed when neither profile nor session can verify capabilities', () => {
    const capabilities = resolveCashierWorkspaceCapabilities(null, {
      id: 'merchant-1',
      nameZh: 'Legacy cache',
      status: 'ACTIVE',
    });

    expect(capabilities).toEqual({ tables: false, pickup: false, delivery: false });
    expect(firstEnabledCashierWorkspace(capabilities)).toBe('order-history');
  });
});
