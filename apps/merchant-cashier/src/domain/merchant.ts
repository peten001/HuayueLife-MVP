import { cashierConfig } from '@/config';
import type { MerchantProfile, MerchantSessionSummary } from '@/types';

export interface CashierWorkspaceCapabilities {
  tables: boolean;
  pickup: boolean;
  delivery: boolean;
}

export function resolveMerchantImageCandidates(profile: MerchantProfile | null | undefined) {
  const visibleImages = (profile?.images ?? []).filter((image) => image.isVisible);
  const values = [
    ...visibleImages.filter((image) => image.imageType === 'STORE').map((image) => image.imageUrl),
    ...visibleImages.filter((image) => image.imageType === 'COVER').map((image) => image.imageUrl),
    profile?.coverUrl,
    ...visibleImages.filter((image) => image.imageType === 'LOGO').map((image) => image.imageUrl),
    profile?.logoUrl,
  ];
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export type CashierWorkspaceRouteName =
  | 'tables'
  | 'pickup-orders'
  | 'delivery-orders'
  | 'order-history';

export function resolveCashierWorkspaceCapabilities(
  profile: MerchantProfile | null | undefined,
  sessionMerchant: MerchantSessionSummary | null | undefined,
): CashierWorkspaceCapabilities {
  const values = profile?.capabilities?.length
    ? profile.capabilities
    : sessionMerchant?.capabilities?.length
      ? sessionMerchant.capabilities
      : null;
  if (values) {
    const enabled = (code: string) => values.some(
      (capability) => capability.code === code && capability.isEnabled,
    );
    return {
      tables: enabled('qrOrderEnabled'),
      pickup: enabled('pickupEnabled'),
      delivery: enabled('deliveryEnabled'),
    };
  }
  if (profile) {
    return {
      tables: Boolean(profile.dineInEnabled),
      pickup: Boolean(profile.pickupEnabled),
      delivery: Boolean(profile.deliveryEnabled),
    };
  }
  // A profile failure must not reopen platform-disabled order channels. The
  // authenticated /me session normally carries capabilities; an old cached
  // session without them falls back to history until capability data recovers.
  return { tables: false, pickup: false, delivery: false };
}

export function cashierWorkspaceEnabled(
  routeName: string | symbol | null | undefined,
  capabilities: CashierWorkspaceCapabilities,
) {
  if (routeName === 'tables') return capabilities.tables;
  if (routeName === 'pickup-orders') return capabilities.pickup;
  if (routeName === 'delivery-orders') return capabilities.delivery;
  return true;
}

export function firstEnabledCashierWorkspace(
  capabilities: CashierWorkspaceCapabilities,
): CashierWorkspaceRouteName {
  if (capabilities.tables) return 'tables';
  if (capabilities.pickup) return 'pickup-orders';
  if (capabilities.delivery) return 'delivery-orders';
  return 'order-history';
}

export function isWithinBusinessHours(
  schedule: Record<string, string[]> | null | undefined,
  at = new Date(),
) {
  if (!schedule || typeof schedule !== 'object') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: cashierConfig.vietnamTimeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts
    .find((part) => part.type === 'weekday')
    ?.value.toLocaleLowerCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const current = hour * 60 + minute;

  return Boolean(
    weekday &&
      schedule[weekday]?.some((range) => {
        const [start, end] = range.split('-').map(toMinutes);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return end >= start
          ? current >= start && current <= end
          : current >= start || current <= end;
      }),
  );
}

export function currentBusinessHoursRange(
  schedule: Record<string, string[]> | null | undefined,
  at = new Date(),
) {
  return formatBusinessHoursRange(schedule, '', at);
}

/**
 * Business-order display for one business day. Cross-midnight ranges are
 * rendered with the next-day marker (e.g. `15:00-次日01:00`) and are never
 * split into natural-day fragments.
 */
export function formatBusinessHoursRange(
  schedule: Record<string, string[]> | null | undefined,
  nextDayLabel: string,
  at = new Date(),
) {
  if (!schedule || typeof schedule !== 'object') return '';
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: cashierConfig.vietnamTimeZone,
    weekday: 'long',
  })
    .format(at)
    .toLocaleLowerCase();
  return (schedule[weekday] ?? [])
    .map((range) => {
      const [start, end] = range.split('-');
      if (!start || !end) return range;
      return toMinutes(end) < toMinutes(start)
        ? `${start}-${nextDayLabel}${end}`
        : `${start}-${end}`;
    })
    .join(' / ');
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
