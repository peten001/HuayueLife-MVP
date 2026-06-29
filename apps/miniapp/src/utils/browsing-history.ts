import { localizedText, merchantName } from '@/i18n';
import type { Locale } from '@/utils/storage';
import type { MerchantSummary } from '@/types/api';

export const MERCHANT_BROWSING_HISTORY_KEY = 'HUAYUE_MERCHANT_BROWSING_HISTORY';
const MAX_BROWSING_HISTORY = 50;

export interface MerchantBrowsingSnapshot {
  id: string;
  name?: string;
  nameZh?: string;
  nameVi?: string;
  nameEn?: string;
  coverUrl?: string;
  logoUrl?: string;
  addressDetail?: string;
  addressZh?: string;
  addressVi?: string;
  addressEn?: string;
  city?: string;
  province?: string;
}

export interface MerchantBrowsingHistoryRecord {
  merchantId: string;
  merchant: MerchantBrowsingSnapshot;
  firstViewedAt: string;
  lastViewedAt: string;
  viewCount: number;
}

export interface MerchantBrowsingHistoryGroup {
  key: 'today' | 'yesterday' | 'earlier';
  records: MerchantBrowsingHistoryRecord[];
}

function normalizeMerchantSnapshot(merchant: MerchantSummary): MerchantBrowsingSnapshot {
  const merchantWithAssets = merchant as MerchantSummary & {
    logoUrl?: string;
    addressZh?: string;
    addressVi?: string;
    addressEn?: string;
  };

  return {
    id: merchant.id,
    name: merchant.name,
    nameZh: merchant.nameZh,
    nameVi: merchant.nameVi,
    nameEn: merchant.nameEn,
    coverUrl: merchant.coverUrl,
    logoUrl: merchantWithAssets.logoUrl,
    addressDetail: merchant.addressDetail,
    addressZh: merchantWithAssets.addressZh,
    addressVi: merchantWithAssets.addressVi,
    addressEn: merchantWithAssets.addressEn,
    city: merchant.city,
    province: merchant.province,
  };
}

function safeArray(value: unknown): MerchantBrowsingHistoryRecord[] {
  return Array.isArray(value) ? (value as MerchantBrowsingHistoryRecord[]) : [];
}

export function getMerchantBrowsingHistory() {
  try {
    return safeArray(uni.getStorageSync(MERCHANT_BROWSING_HISTORY_KEY))
      .filter((item) => item?.merchantId)
      .sort((left, right) => new Date(right.lastViewedAt).getTime() - new Date(left.lastViewedAt).getTime());
  } catch (error) {
    console.warn('[browsing-history] read failed', error);
    return [] as MerchantBrowsingHistoryRecord[];
  }
}

export function addMerchantBrowsingHistory(merchant: MerchantSummary) {
  if (!merchant?.id) return;

  try {
    const now = new Date().toISOString();
    const current = getMerchantBrowsingHistory();
    const existing = current.find((item) => item.merchantId === merchant.id);
    const nextRecord: MerchantBrowsingHistoryRecord = existing
      ? {
          ...existing,
          merchant: {
            ...existing.merchant,
            ...normalizeMerchantSnapshot(merchant),
          },
          lastViewedAt: now,
          viewCount: Math.max(1, existing.viewCount || 0) + 1,
        }
      : {
          merchantId: merchant.id,
          merchant: normalizeMerchantSnapshot(merchant),
          firstViewedAt: now,
          lastViewedAt: now,
          viewCount: 1,
        };

    const deduped = current.filter((item) => item.merchantId !== merchant.id);
    const next = [nextRecord, ...deduped].slice(0, MAX_BROWSING_HISTORY);
    uni.setStorageSync(MERCHANT_BROWSING_HISTORY_KEY, next);
  } catch (error) {
    console.warn('[browsing-history] write failed', error);
  }
}

export function clearMerchantBrowsingHistory() {
  try {
    uni.removeStorageSync(MERCHANT_BROWSING_HISTORY_KEY);
  } catch (error) {
    console.warn('[browsing-history] clear failed', error);
  }
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export function groupBrowsingHistoryByDate(
  records: MerchantBrowsingHistoryRecord[],
  _locale: Locale,
): MerchantBrowsingHistoryGroup[] {
  const todayStart = startOfToday().getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  const groups: MerchantBrowsingHistoryGroup[] = [
    { key: 'today', records: [] },
    { key: 'yesterday', records: [] },
    { key: 'earlier', records: [] },
  ];

  records.forEach((record) => {
    const time = new Date(record.lastViewedAt).getTime();
    if (time >= todayStart) {
      groups[0].records.push(record);
    } else if (time >= yesterdayStart) {
      groups[1].records.push(record);
    } else {
      groups[2].records.push(record);
    }
  });

  return groups.filter((group) => group.records.length > 0);
}

export function browsingHistoryMerchantName(record: MerchantBrowsingHistoryRecord, locale: Locale) {
  return merchantName(record.merchant, locale);
}

export function browsingHistoryMerchantAddress(record: MerchantBrowsingHistoryRecord, locale: Locale) {
  return (
    localizedText(record.merchant, locale, ['addressZh', 'addressVi', 'addressEn', 'addressDetail']) ||
    record.merchant.addressDetail ||
    [record.merchant.province, record.merchant.city].filter(Boolean).join(' / ')
  );
}
