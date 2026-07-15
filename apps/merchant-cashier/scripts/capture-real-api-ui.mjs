import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../../docs/ui-review/merchant-cashier-real-api',
);
const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const verifyOnly = process.argv.includes('--verify-only');
const browserErrors = [];
const apiRequests = [];
const expectedFailureUrls = new Set();
const mockAccessToken = randomUUID();
const generatedUsername = `ui-review-${randomUUID()}`;
const generatedPassword = randomUUID();
const state = {
  emptyPendingOrders: false,
  serviceUnavailable: false,
};

if (!verifyOnly) await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: 'light',
});
const page = await context.newPage();
const apiMock = createApiMock();

await context.route('**/*', async (route) => {
  const requestUrl = new URL(route.request().url());
  if (!requestUrl.pathname.includes('/api/v1/')) {
    await route.continue();
    return;
  }
  await apiMock(route, requestUrl);
});

page.on('console', (message) => {
  if (message.type() === 'error') {
    const location = message.location().url;
    if (
      expectedFailureUrls.has(location)
      && message.text().includes('503 (Service Unavailable)')
    ) return;
    browserErrors.push(`console: ${message.text()}${location ? ` (${location})` : ''}`);
  }
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('requestfailed', (request) => {
  browserErrors.push(
    `request: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'failed'})`,
  );
});

try {
  await openRealLogin();
  await capture('01-login-real-mode-1280x800.png');

  await signInThroughRealClient();
  await capture('02-table-overview-real-1280x800.png');

  await openRoute('/orders/new');
  await page.locator('.order-card').first().waitFor();
  assert.equal(await page.locator('.order-card').count(), 2, 'New-order UI must render API results');
  await capture('03-new-orders-real-1280x800.png');

  await openRoute('/orders/active');
  await page.locator('.order-card').first().waitFor();
  assert.equal(await page.locator('.order-card').count(), 4, 'Active-order UI must merge real statuses');
  await capture('04-active-orders-real-1280x800.png');

  await openRoute('/orders/new');
  await page.locator('.order-card').filter({ hasText: 'LOCAL-1001' }).click();
  await page.locator('.order-detail-panel').waitFor();
  assert.match((await page.locator('.order-detail-panel').textContent()) || '', /LOCAL-1001/);
  await capture('05-order-detail-real-1280x800.png');

  await openRoute('/tables');
  await page.getByTestId('table-card-safe-table-1').click();
  await page.getByTestId('table-detail').waitFor();
  assert.equal(await page.getByTestId('table-detail').locator('.bill-order-row').count(), 3);
  await capture('06-table-session-real-1280x800.png');

  await openRoute('/orders/new');
  state.emptyPendingOrders = true;
  await refreshCurrentOrderPage();
  await page.locator('.cashier-workspace .state-panel--empty').waitFor();
  assert.equal(await page.locator('.cashier-workspace .order-card').count(), 0);
  await capture('07-empty-state-real-1280x800.png');

  state.serviceUnavailable = true;
  await refreshCurrentOrderPage();
  await page.locator('.cashier-workspace .state-panel--error').waitFor();
  assert.doesNotMatch(
    (await page.locator('.cashier-workspace .state-panel--error').textContent()) || '',
    /error\.server/,
  );
  await capture('08-network-error-1280x800.png');

  state.serviceUnavailable = false;
  state.emptyPendingOrders = false;
  await page.locator('.cashier-workspace .state-panel--error .workspace-action-button').click();
  await page.locator('.order-card').first().waitFor();

  await openRoute('/tables');
  await page.getByTestId('table-card-safe-table-1').click();
  await page.getByTestId('table-detail').waitFor();
  await setLocale('vi');
  await assertNoRawTranslationKeys();
  await capture('09-vietnamese-real-1280x800.png');

  await setLocale('en');
  await assertNoRawTranslationKeys();
  await capture('10-english-real-1280x800.png');

  await verifyRealApiEvidence();
  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(
    verifyOnly
      ? 'Verified the cashier real-API client with redacted browser mocks; no Fixture session was used.\n'
      : `Captured redacted real-API review images in ${outputDirectory}\n`,
  );
} finally {
  await browser.close();
}

async function openRealLogin() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.getByTestId('enter-demo').count(),
    0,
    'Fixture entry is visible. Restart Vite with VITE_CASHIER_USE_FIXTURES=false.',
  );
  assert.equal(await page.locator('.demo-entry').count(), 0, 'Real-mode login must not show Fixture controls');
}

async function signInThroughRealClient() {
  await page.locator('input[name="username"]').fill(generatedUsername);
  await page.locator('input[name="password"]').fill(generatedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/tables');
  await page.getByTestId('table-grid').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.table-card').length >= 10);
  await page.evaluate(() => document.fonts.ready);

  const shellText = (await page.locator('.cashier-shell').textContent()) || '';
  assert.match(shellText, /本地测试餐厅/);
  assert.match(shellText, /测试员工/);
  assert.doesNotMatch(shellText, /演示数据|演示员工|DEMO/i);
  assert.equal(await page.locator('.demo-badge').count(), 0);
}

async function openRoute(href) {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (new URL(page.url()).pathname !== href) {
    await page.locator(`a[href="${href}"]:visible`).first().click();
    await page.waitForURL(`**${href}`);
  }
  await page.waitForTimeout(180);
}

async function refreshCurrentOrderPage() {
  const button = page.locator('.cashier-workspace .workspace-action-button').first();
  await button.click();
  await page.waitForFunction(() => {
    const refresh = document.querySelector('.cashier-workspace .workspace-action-button');
    return refresh instanceof HTMLButtonElement && !refresh.disabled;
  });
}

async function setLocale(locale) {
  const expectedLocale = locale === 'zh' ? 'zh-CN' : locale;
  if (await page.locator('html').getAttribute('lang') === expectedLocale) return;
  await page.getByTestId('employee-menu-trigger').click();
  const popover = page.getByTestId('employee-menu-popover');
  await popover.locator('select').selectOption(locale);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (documentLocale) => document.documentElement.lang === documentLocale,
    expectedLocale,
  );
  await clearInteractionFocus();
}

async function capture(fileName) {
  if (verifyOnly) return;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(180);
  await page.evaluate(() => document.fonts.ready);
  await clearInteractionFocus();
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
    animations: 'disabled',
  });
}

async function clearInteractionFocus() {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(1, 1);
}

async function assertNoRawTranslationKeys() {
  const text = (await page.locator('.cashier-shell').textContent()) || '';
  assert.doesNotMatch(text, /(?:bill\.itemSummary|error\.server)/);
}

async function verifyRealApiEvidence() {
  const calls = apiRequests.filter((request) => request.method !== 'OPTIONS');
  const loginCall = calls.find((request) => request.path === '/merchant/auth/login');
  assert.ok(loginCall, 'The real merchant login endpoint was not called');
  assert.equal(loginCall.authorization, '', 'Login must not send an existing bearer token');

  for (const expectedPath of [
    '/merchant/profile',
    '/merchant/tables',
    '/merchant/table-sessions/open',
  ]) {
    assert.ok(calls.some((request) => request.path === expectedPath), `Missing API call ${expectedPath}`);
  }
  assert.ok(
    calls.some((request) => request.path.startsWith('/merchant/orders?')),
    'The real merchant orders endpoint was not called',
  );
  assert.ok(
    calls.some((request) => request.path === '/merchant/orders/safe-order-pending-1'),
    'The real order-detail endpoint was not called',
  );
  assert.ok(
    calls.some((request) => request.path === '/merchant/table-sessions/safe-session-1'),
    'The real TableSession detail endpoint was not called',
  );

  const authenticatedCalls = calls.filter(
    (request) => request.path.startsWith('/merchant/') && request.path !== '/merchant/auth/login',
  );
  assert.ok(authenticatedCalls.length > 0);
  assert.equal(
    authenticatedCalls.every((request) => request.authorization === `Bearer ${mockAccessToken}`),
    true,
    'Authenticated real-API calls must use the stored bearer token',
  );
  assert.equal(await page.locator('.demo-badge').count(), 0, 'Fixture badge leaked into real mode');
}

function createApiMock() {
  const fixture = createRedactedApiData();

  return async (route, requestUrl) => {
    const request = route.request();
    const method = request.method();
    const apiPrefixIndex = requestUrl.pathname.indexOf('/api/v1');
    const path = `${requestUrl.pathname.slice(apiPrefixIndex + '/api/v1'.length)}${requestUrl.search}`;
    const authorization = request.headers().authorization || '';
    apiRequests.push({ method, path, authorization });

    if (method === 'OPTIONS') {
      await fulfill(route, 204, null);
      return;
    }

    if (path === '/merchant/auth/login' && method === 'POST') {
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['password', 'username']);
      await success(route, {
        accessToken: mockAccessToken,
        staff: fixture.staff,
      });
      return;
    }

    if (path === '/merchant/me' && method === 'GET') {
      await requireAuthentication(route, authorization, {
        user: {
          sub: fixture.staff.id,
          accountType: 'MERCHANT_STAFF',
          merchantId: fixture.staff.merchant.id,
          role: fixture.staff.role,
          username: fixture.staff.username,
          mustChangePassword: false,
          merchant: fixture.staff.merchant,
        },
      });
      return;
    }

    if (state.serviceUnavailable && path.startsWith('/merchant/')) {
      expectedFailureUrls.add(request.url());
      await failure(route, 503, 'SERVICE_UNAVAILABLE', '服务暂时不可用，请检查网络后重试');
      return;
    }

    if (path === '/merchant/profile' && method === 'GET') {
      await requireAuthentication(route, authorization, fixture.profile);
      return;
    }
    if (path === '/merchant/tables' && method === 'GET') {
      await requireAuthentication(route, authorization, fixture.tables);
      return;
    }
    if (path === '/merchant/table-sessions/open' && method === 'GET') {
      await requireAuthentication(route, authorization, { sessions: fixture.sessions });
      return;
    }

    const sessionMatch = path.match(/^\/merchant\/table-sessions\/([^/?]+)$/);
    if (sessionMatch && method === 'GET') {
      const session = fixture.sessionDetails.get(decodeURIComponent(sessionMatch[1]));
      if (!session) {
        await failure(route, 404, 'HTTP_404', 'Table session not found');
        return;
      }
      await requireAuthentication(route, authorization, { session });
      return;
    }

    const closeSessionMatch = path.match(/^\/merchant\/table-sessions\/([^/?]+)\/close$/);
    if (closeSessionMatch && method === 'POST') {
      const session = fixture.sessionDetails.get(decodeURIComponent(closeSessionMatch[1]));
      if (!session) {
        await failure(route, 404, 'HTTP_404', 'Table session not found');
        return;
      }
      await requireAuthentication(route, authorization, {
        session: { ...session, status: 'CLOSED', closedAt: new Date().toISOString() },
      });
      return;
    }

    if (requestUrl.pathname.endsWith('/merchant/orders') && method === 'GET') {
      const status = requestUrl.searchParams.get('status');
      const orderType = requestUrl.searchParams.get('orderType');
      const orders = fixture.orders.filter((order) => {
        if (state.emptyPendingOrders && status === 'PENDING_ACCEPTANCE') return false;
        return (!status || order.status === status) && (!orderType || order.orderType === orderType);
      });
      await requireAuthentication(route, authorization, orders);
      return;
    }

    const orderActionMatch = path.match(
      /^\/merchant\/orders\/([^/?]+)\/(accept|reject|start-preparing|ready|start-delivery|complete)$/,
    );
    if (orderActionMatch && method === 'POST') {
      const order = fixture.orders.find((item) => item.id === decodeURIComponent(orderActionMatch[1]));
      if (!order) {
        await failure(route, 404, 'HTTP_404', 'Order not found');
        return;
      }
      const nextStatus = {
        accept: 'ACCEPTED',
        reject: 'CANCELLED',
        'start-preparing': 'PREPARING',
        ready: 'READY',
        'start-delivery': 'DELIVERING',
        complete: 'COMPLETED',
      }[orderActionMatch[2]];
      Object.assign(order, { status: nextStatus, updatedAt: new Date().toISOString() });
      await requireAuthentication(route, authorization, order);
      return;
    }

    const orderMatch = path.match(/^\/merchant\/orders\/([^/?]+)$/);
    if (orderMatch && method === 'GET') {
      const order = fixture.orders.find((item) => item.id === decodeURIComponent(orderMatch[1]));
      if (!order) {
        await failure(route, 404, 'HTTP_404', 'Order not found');
        return;
      }
      await requireAuthentication(route, authorization, order);
      return;
    }

    await failure(route, 404, 'HTTP_404', `Unhandled local UI mock endpoint: ${method}`);
  };
}

async function requireAuthentication(route, authorization, data) {
  if (authorization !== `Bearer ${mockAccessToken}`) {
    await failure(route, 401, 'HTTP_401', 'Invalid or expired token');
    return;
  }
  await success(route, data);
}

async function success(route, data) {
  await fulfill(route, 200, {
    code: 'OK',
    message: 'success',
    data,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

async function failure(route, status, code, message) {
  await fulfill(route, status, {
    code,
    message,
    data: null,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    headers: {
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-origin': new URL(baseUrl).origin,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      vary: 'Origin',
    },
    body: body === null ? '' : JSON.stringify(body),
  });
}

function createRedactedApiData() {
  const now = Date.now();
  const isoAgo = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const logoUrl = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 rx=%2218%22 fill=%22%2319c37d%22/%3E%3Cpath d=%22M20 42h40M28 30h24M25 42v18M55 42v18%22 stroke=%22white%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';
  const merchant = {
    id: 'safe-merchant-1',
    nameZh: '本地测试餐厅',
    status: 'ACTIVE',
    merchantMode: 'QR_ORDER',
    reportFeatureEnabled: false,
    capabilities: [
      { code: 'qrOrderEnabled', groupCode: 'RESTAURANT', isEnabled: true },
      { code: 'tableManagementEnabled', groupCode: 'RESTAURANT', isEnabled: true },
      { code: 'voiceNotifyEnabled', groupCode: 'RESTAURANT', isEnabled: true },
    ],
  };
  const staff = {
    id: 'safe-staff-1',
    username: 'local-review-user',
    displayName: '测试员工',
    role: 'MANAGER',
    mustChangePassword: false,
    merchant,
  };
  const profile = {
    id: merchant.id,
    nameZh: merchant.nameZh,
    nameVi: 'Nhà hàng thử',
    nameEn: 'Local Test Cafe',
    merchantType: 'RESTAURANT',
    merchantMode: 'QR_ORDER',
    logoUrl,
    coverUrl: null,
    contactName: '测试联系人',
    contactPhone: '09•••0000',
    province: '测试省份',
    city: '测试城市',
    district: '测试区域',
    addressDetail: '脱敏测试地址',
    latitude: '0',
    longitude: '0',
    businessHours: Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((day) => [day, ['00:00-23:59']]),
    ),
    notice: null,
    minimumDeliveryAmountVnd: '0',
    deliveryFeeVnd: '0',
    deliveryRadiusKm: '0',
    dineInEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    isVisibleOnClient: false,
    status: 'ACTIVE',
    capabilities: merchant.capabilities,
    images: [],
  };

  const tableNumbers = Array.from({ length: 15 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`);
  const tables = tableNumbers.map((tableNo, index) => ({
    id: `safe-table-${index + 1}`,
    merchantId: merchant.id,
    tableNo,
    tableName: index < 4 ? '靠窗区' : index < 10 ? '大厅区' : '包厢区',
    qrToken: `safe-qr-${index + 1}`,
    qrVersion: 1,
    status: index === tableNumbers.length - 1 ? 'DISABLED' : 'ACTIVE',
    createdAt: isoAgo(20_000),
    updatedAt: isoAgo(20),
  }));

  const makeItem = (id, names, quantity, unitPriceVnd, remark = null) => ({
    id,
    productId: null,
    productNameZhSnapshot: names.zh,
    imageUrlSnapshot: null,
    unitPriceVnd: String(unitPriceVnd),
    quantity,
    subtotalVnd: String(unitPriceVnd * quantity),
    remark,
  });
  const makeOrder = ({ id, orderNo, status, orderType, tableIndex, minutesAgo, items, total, remark }) => ({
    id,
    orderNo,
    merchantId: merchant.id,
    tableId: tableIndex ? `safe-table-${tableIndex}` : null,
    tableSessionId: tableIndex && tableIndex <= 2 ? `safe-session-${tableIndex}` : null,
    tableNoSnapshot: tableIndex ? tableNumbers[tableIndex - 1] : null,
    orderType,
    status,
    contactName: orderType === 'DINE_IN' ? null : '测试顾客',
    contactPhone: orderType === 'DINE_IN' ? null : '09•••1234',
    deliveryAddress: orderType === 'DELIVERY' ? '脱敏配送地址' : null,
    customerRemark: remark || null,
    itemAmountVnd: String(total),
    deliveryFeeVnd: '0',
    totalAmountVnd: String(total),
    settlementStatus: status === 'COMPLETED' ? 'SETTLED' : 'UNSETTLED',
    acceptedAt: status === 'PENDING_ACCEPTANCE' ? null : isoAgo(minutesAgo - 2),
    readyAt: ['READY', 'DELIVERING', 'COMPLETED'].includes(status) ? isoAgo(minutesAgo - 5) : null,
    completedAt: status === 'COMPLETED' ? isoAgo(2) : null,
    cancelledAt: status === 'CANCELLED' ? isoAgo(3) : null,
    cancelReason: status === 'CANCELLED' ? '本地联调取消样例' : null,
    createdAt: isoAgo(minutesAgo),
    updatedAt: isoAgo(Math.max(1, minutesAgo - 5)),
    table: tableIndex
      ? { id: `safe-table-${tableIndex}`, tableNo: tableNumbers[tableIndex - 1], tableName: '测试桌台' }
      : null,
    user: { id: `safe-user-${id}`, nickname: '测试顾客', phone: null },
    items,
    statusLogs: [
      {
        id: `safe-log-${id}`,
        fromStatus: null,
        toStatus: 'PENDING_ACCEPTANCE',
        operatorType: 'USER',
        operatorStaffId: null,
        operatorStaff: null,
        remark: null,
        createdAt: isoAgo(minutesAgo),
      },
    ],
  });

  const pho = makeItem(
    'safe-item-pho',
    { zh: '招牌牛肉粉', vi: 'Phở bò đặc biệt', en: 'Special beef pho' },
    2,
    85_000,
    '一份不加香菜',
  );
  const coffee = makeItem(
    'safe-item-coffee',
    { zh: '越南滴漏咖啡', vi: 'Cà phê phin', en: 'Vietnamese drip coffee' },
    1,
    45_000,
  );
  const springRoll = makeItem(
    'safe-item-roll',
    { zh: '鲜虾春卷', vi: 'Gỏi cuốn tôm', en: 'Fresh shrimp rolls' },
    2,
    50_000,
  );

  const orders = [
    makeOrder({
      id: 'safe-order-pending-1',
      orderNo: 'LOCAL-1001',
      status: 'PENDING_ACCEPTANCE',
      orderType: 'DINE_IN',
      tableIndex: 1,
      minutesAgo: 8,
      items: [pho, coffee],
      total: 215_000,
      remark: '本地联调备注，不含真实顾客信息',
    }),
    makeOrder({
      id: 'safe-order-pending-2',
      orderNo: 'LOCAL-1002',
      status: 'PENDING_ACCEPTANCE',
      orderType: 'PICKUP',
      tableIndex: null,
      minutesAgo: 5,
      items: [springRoll],
      total: 100_000,
    }),
    makeOrder({
      id: 'safe-order-accepted',
      orderNo: 'LOCAL-1003',
      status: 'ACCEPTED',
      orderType: 'DINE_IN',
      tableIndex: 1,
      minutesAgo: 35,
      items: [springRoll],
      total: 100_000,
    }),
    makeOrder({
      id: 'safe-order-preparing',
      orderNo: 'LOCAL-1004',
      status: 'PREPARING',
      orderType: 'DINE_IN',
      tableIndex: 2,
      minutesAgo: 28,
      items: [pho],
      total: 170_000,
    }),
    makeOrder({
      id: 'safe-order-ready',
      orderNo: 'LOCAL-1005',
      status: 'READY',
      orderType: 'PICKUP',
      tableIndex: null,
      minutesAgo: 24,
      items: [coffee],
      total: 45_000,
    }),
    makeOrder({
      id: 'safe-order-delivering',
      orderNo: 'LOCAL-1006',
      status: 'DELIVERING',
      orderType: 'DELIVERY',
      tableIndex: null,
      minutesAgo: 48,
      items: [pho],
      total: 170_000,
    }),
    makeOrder({
      id: 'safe-order-completed',
      orderNo: 'LOCAL-0999',
      status: 'COMPLETED',
      orderType: 'DINE_IN',
      tableIndex: 1,
      minutesAgo: 90,
      items: [coffee],
      total: 45_000,
    }),
    makeOrder({
      id: 'safe-order-cancelled',
      orderNo: 'LOCAL-0998',
      status: 'CANCELLED',
      orderType: 'PICKUP',
      tableIndex: null,
      minutesAgo: 110,
      items: [springRoll],
      total: 100_000,
    }),
  ];

  const firstSessionOrders = orders.filter((order) => order.tableSessionId === 'safe-session-1');
  const secondSessionOrders = orders.filter((order) => order.tableSessionId === 'safe-session-2');
  const summarizeSession = (id, tableIndex, sessionOrders, openedMinutesAgo) => ({
    id,
    sessionNo: `LOCAL-SESSION-${tableIndex}`,
    merchantId: merchant.id,
    tableId: `safe-table-${tableIndex}`,
    tableNo: tableNumbers[tableIndex - 1],
    tableName: '测试桌台',
    status: 'OPEN',
    openedAt: isoAgo(openedMinutesAgo),
    closedAt: null,
    orderCount: sessionOrders.length,
    itemCount: sessionOrders.reduce(
      (total, order) => total + order.items.reduce((count, item) => count + item.quantity, 0),
      0,
    ),
    totalAmountVnd: String(
      sessionOrders.reduce((total, order) => total + Number(order.totalAmountVnd), 0),
    ),
    latestOrderAt: sessionOrders[0]?.createdAt || null,
    pendingOrderCount: sessionOrders.filter((order) => order.status === 'PENDING_ACCEPTANCE').length,
    unfinishedOrderCount: sessionOrders.filter(
      (order) => !['COMPLETED', 'CANCELLED'].includes(order.status),
    ).length,
  });
  const sessions = [
    summarizeSession('safe-session-1', 1, firstSessionOrders, 95),
    summarizeSession('safe-session-2', 2, secondSessionOrders, 55),
  ];
  const sessionDetails = new Map([
    ['safe-session-1', { ...sessions[0], orders: firstSessionOrders }],
    ['safe-session-2', { ...sessions[1], orders: secondSessionOrders }],
  ]);

  return { staff, profile, tables, sessions, sessionDetails, orders };
}
