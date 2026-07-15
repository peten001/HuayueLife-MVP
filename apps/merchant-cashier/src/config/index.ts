const DEFAULT_API_BASE_URL = import.meta.env.PROD
  ? 'https://api.huayueyouxuan.com/api/v1'
  : 'http://localhost:3001/api/v1';

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export const cashierConfig = Object.freeze({
  brandName: 'Yunqiao',
  apiBaseUrl: withoutTrailingSlash(
    import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
  ),
  merchantAdminUrl:
    import.meta.env.VITE_MERCHANT_ADMIN_URL?.trim() ||
    'https://admin.huayueyouxuan.com/',
  fixturesEnabled: import.meta.env.VITE_CASHIER_USE_FIXTURES === 'true',
  requestTimeoutMs: 15_000,
  livePollingIntervalMs: 10_000,
  vietnamTimeZone: 'Asia/Ho_Chi_Minh',
  demoLabel: 'DEMO · 演示数据 / Dữ liệu demo / Demo data',
});

export const cashierStorageKeys = Object.freeze({
  accessToken: 'yunqiao_cashier_access_token',
  staffSession: 'yunqiao_cashier_staff_session',
  locale: 'yunqiao_cashier_locale',
  pendingOrderSnapshotPrefix: 'yunqiao_cashier_pending_orders',
  printRequestKeys: 'yunqiao_cashier_print_request_keys',
});

export const CASHIER_UNAUTHORIZED_EVENT = 'yunqiao-cashier:unauthorized';
export const CASHIER_API_ACTIVITY_EVENT = 'yunqiao-cashier:api-activity';
