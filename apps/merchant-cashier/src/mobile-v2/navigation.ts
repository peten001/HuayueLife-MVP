import type {
  RouteLocationRaw,
  RouteRecordNameGeneric,
} from 'vue-router';

export const MOBILE_V2_PREVIEW_ROOT = '/__preview/mobile-v2';

export const mobileV2PreviewRouteNames = {
  tables: 'mobile-v2-preview-tables',
  pickup: 'mobile-v2-preview-pickup',
  delivery: 'mobile-v2-preview-delivery',
  history: 'mobile-v2-preview-history',
} as const;

export type CashierPresentationWorkspace = keyof typeof mobileV2PreviewRouteNames;

const canonicalRouteNameByPreviewRoute = new Map<RouteRecordNameGeneric, string>([
  [mobileV2PreviewRouteNames.tables, 'tables'],
  [mobileV2PreviewRouteNames.pickup, 'pickup-orders'],
  [mobileV2PreviewRouteNames.delivery, 'delivery-orders'],
  [mobileV2PreviewRouteNames.history, 'order-history'],
]);

const previewRouteNameByCanonicalRoute = new Map<RouteRecordNameGeneric, string>([
  ['tables', mobileV2PreviewRouteNames.tables],
  ['pickup-orders', mobileV2PreviewRouteNames.pickup],
  ['delivery-orders', mobileV2PreviewRouteNames.delivery],
  ['order-history', mobileV2PreviewRouteNames.history],
]);

const previewPathByCanonicalPath = new Map([
  ['/tables', `${MOBILE_V2_PREVIEW_ROOT}/tables`],
  ['/pickup', `${MOBILE_V2_PREVIEW_ROOT}/pickup`],
  ['/delivery', `${MOBILE_V2_PREVIEW_ROOT}/delivery`],
  ['/orders/history', `${MOBILE_V2_PREVIEW_ROOT}/history`],
]);

export function canonicalCashierRouteName(name: RouteRecordNameGeneric | null | undefined) {
  if (!import.meta.env.DEV) return name;
  return canonicalRouteNameByPreviewRoute.get(name ?? '') ?? name;
}

export function isMobileV2PreviewRouteName(name: RouteRecordNameGeneric | null | undefined) {
  if (!import.meta.env.DEV) return false;
  return canonicalRouteNameByPreviewRoute.has(name ?? '');
}

export function cashierPresentationWorkspace(name: RouteRecordNameGeneric | null | undefined): CashierPresentationWorkspace | null {
  const canonicalName = canonicalCashierRouteName(name);
  if (canonicalName === 'tables') return 'tables';
  if (canonicalName === 'pickup-orders') return 'pickup';
  if (canonicalName === 'delivery-orders') return 'delivery';
  if (canonicalName === 'order-history') return 'history';
  return null;
}

/**
 * Keep navigation inside the isolated preview without changing any business
 * destination. Production routes pass through byte-for-byte unchanged.
 */
export function resolveCashierPresentationLocation(
  mobileV2Preview: boolean,
  location: RouteLocationRaw,
): RouteLocationRaw {
  if (!import.meta.env.DEV || !mobileV2Preview) return location;

  if (typeof location === 'string') {
    return previewPathByCanonicalPath.get(location) ?? location;
  }

  if ('name' in location && location.name) {
    const previewName = previewRouteNameByCanonicalRoute.get(location.name);
    return previewName ? { ...location, name: previewName } : location;
  }

  if ('path' in location && typeof location.path === 'string') {
    const previewPath = previewPathByCanonicalPath.get(location.path);
    return previewPath ? { ...location, path: previewPath } : location;
  }

  return location;
}
