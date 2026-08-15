import { describe, expect, it } from 'vitest';
import type { MerchantProfile } from '@/types';
import {
  cashierWorkspaceEnabled,
  currentBusinessHoursRange,
  firstEnabledCashierWorkspace,
  formatBusinessHoursRange,
  isWithinBusinessHours,
  resolveCashierWorkspaceCapabilities,
  resolveMerchantImageCandidates,
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

  it('renders cross-midnight ranges with a next-day marker instead of natural-day fragments', () => {
    const crossMidnight = {
      tuesday: ['15:00-01:00'],
    };
    expect(formatBusinessHoursRange(
      crossMidnight,
      '次日',
      new Date('2026-07-14T08:00:00.000Z'),
    )).toBe('15:00-次日01:00');

    const multiSegment = {
      tuesday: ['11:00-14:00', '16:00-01:00'],
    };
    expect(formatBusinessHoursRange(
      multiSegment,
      '次日',
      new Date('2026-07-14T08:00:00.000Z'),
    )).toBe('11:00-14:00 / 16:00-次日01:00');
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

function profile(overrides: Partial<MerchantProfile> = {}): MerchantProfile {
  return {
    id: 'merchant-1', nameZh: '很长的越南语商家名称', merchantType: 'RESTAURANT',
    contactName: '', contactPhone: '', province: '', city: '', addressDetail: '',
    latitude: '0', longitude: '0', businessHours: {}, minimumDeliveryAmountVnd: '0',
    deliveryFeeVnd: '0', deliveryRadiusKm: '0', dineInEnabled: true, pickupEnabled: true,
    deliveryEnabled: true, isVisibleOnClient: true, status: 'ACTIVE', ...overrides,
  };
}

describe('resolveMerchantImageCandidates', () => {
  it('prioritizes storefront, cover and logo imagery', () => {
    expect(resolveMerchantImageCandidates(profile({
      coverUrl: '/legacy-cover.jpg', logoUrl: '/legacy-logo.jpg',
      images: [
        { id: '3', imageType: 'LOGO', imageUrl: '/logo.jpg', sortOrder: 0, isVisible: true },
        { id: '2', imageType: 'COVER', imageUrl: '/cover.jpg', sortOrder: 0, isVisible: true },
        { id: '1', imageType: 'STORE', imageUrl: '/store.jpg', sortOrder: 0, isVisible: true },
      ],
    }))).toEqual(['/store.jpg', '/cover.jpg', '/legacy-cover.jpg', '/logo.jpg', '/legacy-logo.jpg']);
  });

  it('falls back to logo when no storefront image exists', () => {
    expect(resolveMerchantImageCandidates(profile({ logoUrl: '/logo.jpg' }))).toEqual(['/logo.jpg']);
  });

  it('returns no image when storefront and logo are both absent', () => {
    expect(resolveMerchantImageCandidates(profile())).toEqual([]);
  });

  it('ignores hidden images and removes duplicate URLs', () => {
    expect(resolveMerchantImageCandidates(profile({ coverUrl: '/cover.jpg', images: [
      { id: '1', imageType: 'STORE', imageUrl: '/hidden.jpg', sortOrder: 0, isVisible: false },
      { id: '2', imageType: 'COVER', imageUrl: '/cover.jpg', sortOrder: 0, isVisible: true },
    ] }))).toEqual(['/cover.jpg']);
  });
});
