import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const outputDirectory = process.env.CASHIER_CATALOG_PERF_OUTPUT;
const label = process.env.CASHIER_CATALOG_PERF_LABEL || 'local';
const iterations = Number(process.env.CASHIER_CATALOG_PERF_ITERATIONS || 5);
const catalogDelayMs = Number(process.env.CASHIER_CATALOG_PERF_DELAY_MS || 550);
const bootstrapDelayMs = Number(process.env.CASHIER_BOOTSTRAP_PERF_DELAY_MS || 80);
const imageDelayMs = Number(process.env.CASHIER_IMAGE_PERF_DELAY_MS || 240);

assert.ok(outputDirectory, 'CASHIER_CATALOG_PERF_OUTPUT is required');
assert.ok(Number.isInteger(iterations) && iterations >= 5, 'At least 5 iterations are required');

const apiEvents = [];
const imageEvents = [];
const browserErrors = [];
const merchant = {
  id: 'catalog-perf-merchant',
  nameZh: '菜单性能测试餐厅',
  status: 'ACTIVE',
  merchantMode: 'QR_ORDER',
  reportFeatureEnabled: false,
  capabilities: [
    { code: 'qrOrderEnabled', groupCode: 'RESTAURANT', isEnabled: true },
    { code: 'tableManagementEnabled', groupCode: 'RESTAURANT', isEnabled: true },
  ],
};
const staff = {
  id: 'catalog-perf-staff',
  username: 'catalog-perf-user',
  displayName: '性能测试员工',
  role: 'MANAGER',
  mustChangePassword: false,
  merchant,
};
const profile = {
  id: merchant.id,
  nameZh: merchant.nameZh,
  nameVi: 'Nhà hàng kiểm thử hiệu năng',
  nameEn: 'Catalog Performance Restaurant',
  merchantType: 'RESTAURANT',
  merchantMode: 'QR_ORDER',
  logoUrl: null,
  coverUrl: null,
  contactName: '测试联系人',
  contactPhone: '0000000000',
  province: '测试省',
  city: '测试市',
  district: '测试区',
  addressDetail: '测试地址',
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
  pickupEnabled: false,
  deliveryEnabled: false,
  isVisibleOnClient: false,
  status: 'ACTIVE',
  capabilities: merchant.capabilities,
  images: [],
};
const tables = Array.from({ length: 3 }, (_, index) => ({
  id: `catalog-perf-table-${index + 1}`,
  merchantId: merchant.id,
  tableNo: `P${index + 1}`,
  tableName: '性能区',
  qrToken: `catalog-perf-qr-${index + 1}`,
  qrVersion: 1,
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}));
const categories = Array.from({ length: 8 }, (_, index) => ({
  id: `catalog-perf-category-${index + 1}`,
  nameZh: `分类${index + 1}`,
  nameVi: `Danh mục ${index + 1}`,
  nameEn: `Category ${index + 1}`,
  sortOrder: index + 1,
  isActive: true,
}));
const products = Array.from({ length: 201 }, (_, index) => {
  const category = categories[index % categories.length];
  return {
    id: `catalog-perf-product-${index + 1}`,
    categoryId: category.id,
    nameZh: `性能测试菜品${String(index + 1).padStart(3, '0')}`,
    nameVi: `Món kiểm thử ${index + 1}`,
    nameEn: `Performance dish ${index + 1}`,
    description: null,
    imageUrl: `/uploads/products/catalog-perf-product-${index + 1}.svg`,
    priceVnd: String(20_000 + index * 1_000),
    unit: index % 2 === 0 ? '份' : '盘',
    sortOrder: index + 1,
    status: 'ON_SALE',
    productType: 'FOOD',
    category,
  };
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
await context.addInitScript(() => {
  window.__catalogPerfLayoutShift = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__catalogPerfLayoutShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // LayoutShift is not available in every browser build.
  }
});
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('requestfailed', (request) => {
  if (
    (
      request.url().includes('/uploads/products/catalog-perf-product-')
      || request.url().includes('/merchant/categories')
      || request.url().includes('/merchant/products')
    )
    && request.failure()?.errorText.includes('ERR_ABORTED')
  ) return;
  browserErrors.push(`request: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'failed'})`);
});

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.includes('/api/v1/uploads/products/catalog-perf-product-')) {
    const event = { url: url.pathname, startedAt: Date.now(), completedAt: 0 };
    imageEvents.push(event);
    await delay(imageDelayMs);
    event.completedAt = Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e9f4ef"/><circle cx="320" cy="240" r="120" fill="#36a270"/></svg>',
    });
    return;
  }
  const apiIndex = url.pathname.indexOf('/api/v1');
  if (apiIndex < 0) {
    await route.continue();
    return;
  }
  const path = url.pathname.slice(apiIndex + '/api/v1'.length);
  const event = { method: request.method(), path, search: url.search, startedAt: Date.now(), completedAt: 0 };
  apiEvents.push(event);
  const catalogRequest = path === '/merchant/categories' || path === '/merchant/products';
  const bootstrapRequest = [
    '/merchant/me',
    '/merchant/profile',
    '/merchant/tables',
    '/merchant/table-sessions/open',
    '/merchant/printing/feature-state',
    '/merchant/printing/printers',
  ].includes(path) || path === '/merchant/orders';
  if (catalogRequest) await delay(catalogDelayMs);
  else if (bootstrapRequest) await delay(bootstrapDelayMs);
  const body = responseFor(request.method(), path);
  event.completedAt = Date.now();
  await route.fulfill({
    status: body.status || 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      code: body.status ? 'HTTP_404' : 'OK',
      message: body.status ? 'Not found' : 'success',
      data: body.data,
      requestId: 'catalog-perf-request',
      timestamp: new Date().toISOString(),
    }),
  });
});

try {
  await signIn();
  const bootstrap = await measureBootstrap();
  const noCacheImmediate = await measureFirstOpen({ waitBeforeOpenMs: 0, clearCatalog: true });
  const noCachePrefetchWindow = await measureFirstOpen({ waitBeforeOpenMs: 1_500, clearCatalog: true });
  await primeCatalog();
  const persistentReload = [];
  for (let index = 0; index < iterations; index += 1) {
    persistentReload.push(await measureFirstOpen({ waitBeforeOpenMs: 0, clearCatalog: false }));
  }
  const reopen = await measureReopen();
  const tableSwitch = await measureTableSwitch();
  const imageLoading = await measureImageFanout();
  const responsiveMenu = await measureResponsiveMenu();

  const result = {
    label,
    generatedAt: new Date().toISOString(),
    configuration: {
      products: products.length,
      categories: categories.length,
      iterations,
      catalogDelayMs,
      bootstrapDelayMs,
      imageDelayMs,
      viewport: '1280x800',
    },
    bootstrap,
    scenarios: {
      noCacheImmediate,
      noCachePrefetchWindow,
      persistentReload: summarizeRuns(persistentReload),
      persistentReloadRuns: persistentReload,
      reopen,
      tableSwitch,
    },
    imageLoading,
    responsiveMenu,
    browserErrors,
  };
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = `${outputDirectory}/${label}.json`;
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Wrote ${outputPath}\n`);
} finally {
  await browser.close();
}

function responseFor(method, path) {
  if (path === '/merchant/auth/login' && method === 'POST') {
    return { data: { accessToken: 'catalog-perf-token', staff } };
  }
  if (path === '/merchant/me' && method === 'GET') {
    return {
      data: {
        user: {
          sub: staff.id,
          accountType: 'MERCHANT_STAFF',
          merchantId: merchant.id,
          role: staff.role,
          username: staff.username,
          mustChangePassword: false,
          merchant,
        },
      },
    };
  }
  if (path === '/merchant/profile' && method === 'GET') return { data: profile };
  if (path === '/merchant/tables' && method === 'GET') return { data: tables };
  if (path === '/merchant/table-sessions/open' && method === 'GET') return { data: { sessions: [] } };
  if (path === '/merchant/orders' && method === 'GET') return { data: [] };
  if (path === '/merchant/printing/feature-state' && method === 'GET') {
    return {
      data: {
        taskCenterEnabled: false,
        automaticCreationEnabled: false,
        executionEnabled: false,
        legacyPrintingEnabled: false,
        merchantPrintingEnabled: false,
        executionState: 'CONNECTOR_PENDING',
      },
    };
  }
  if (path === '/merchant/printing/printers' && method === 'GET') return { data: [] };
  if (path === '/merchant/categories' && method === 'GET') return { data: categories };
  if (path === '/merchant/products' && method === 'GET') return { data: products };
  return { status: 404, data: { code: 'HTTP_404', message: `Unhandled ${method} ${path}` } };
}

async function signIn() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill(staff.username);
  await page.locator('input[name="password"]').fill('local-performance-password');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname === '/tables', null, { timeout: 5_000 });
  await page.locator('[data-cashier-ready="true"]').waitFor();
  await page.getByTestId(`table-card-${tables[0].id}`).waitFor();
}

async function measureBootstrap() {
  const runs = [];
  for (let index = 0; index < iterations; index += 1) {
    await page.waitForTimeout(catalogDelayMs + 100);
    await clearCatalogCache();
    const eventIndex = apiEvents.length;
    const startedAt = Date.now();
    await page.goto(`${baseUrl}/tables`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cashier-ready="true"]').waitFor();
    const observedReadyAt = Date.now();
    const readyTiming = await page.evaluate(() => {
      const entry = performance.getEntriesByName('cashier-bootstrap-ready').at(-1);
      return {
        readyMs: entry?.startTime || 0,
        readyAt: performance.timeOrigin + (entry?.startTime || 0),
      };
    });
    await page.waitForTimeout(120);
    const events = apiEvents.slice(eventIndex);
    const catalogStartedAt = events
      .filter(isCatalogEvent)
      .map((event) => event.startedAt)
      .sort((a, b) => a - b)[0] || null;
    runs.push({
      readyMs: observedReadyAt - startedAt,
      navigationReadyMarkMs: Math.round(readyTiming.readyMs),
      catalogStartedAfterReadyMs: catalogStartedAt === null ? null : Math.round(catalogStartedAt - readyTiming.readyAt),
      catalogEndpointRequests: events.filter(isCatalogEvent).length,
    });
  }
  return { ...summarizeNumbers(runs.map((run) => run.readyMs)), runs };
}

async function measureFirstOpen({ waitBeforeOpenMs, clearCatalog }) {
  if (clearCatalog) await clearCatalogCache();
  const eventIndex = apiEvents.length;
  const imageIndex = imageEvents.length;
  await page.goto(`${baseUrl}/tables/${tables[0].id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cashier-ready="true"]').waitFor();
  await waitForSelectedTable(tables[0].id);
  if (waitBeforeOpenMs) await page.waitForTimeout(waitBeforeOpenMs);
  const clickedAt = Date.now();
  await page.getByTestId('main-tab-menu').click();
  await waitForMenuReady();
  const readyAt = Date.now();
  const events = apiEvents.slice(eventIndex);
  const catalogEvents = events.filter(isCatalogEvent);
  const images = imageEvents.slice(imageIndex);
  return {
    uiReadyMs: readyAt - clickedAt,
    categoriesHttp: catalogEvents.filter((event) => event.path === '/merchant/categories').length,
    productsHttp: catalogEvents.filter((event) => event.path === '/merchant/products').length,
    catalogPairRequests: Math.max(
      catalogEvents.filter((event) => event.path === '/merchant/categories').length,
      catalogEvents.filter((event) => event.path === '/merchant/products').length,
    ),
    catalogAlreadyInFlightAtClick: catalogEvents.some((event) => event.startedAt < clickedAt && event.completedAt > clickedAt),
    catalogCompletedBeforeClick: catalogEvents.length > 0
      && catalogEvents.every((event) => event.completedAt > 0 && event.completedAt <= clickedAt),
    catalogRequestsBlockingAtClick: catalogEvents.filter((event) =>
      event.startedAt <= readyAt && event.completedAt > clickedAt,
    ).length,
    imageRequestsBeforeUiReady: images.filter((event) =>
      event.startedAt >= clickedAt && event.startedAt <= readyAt,
    ).length,
  };
}

async function primeCatalog() {
  await page.goto(`${baseUrl}/tables/${tables[0].id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cashier-ready="true"]').waitFor();
  await waitForSelectedTable(tables[0].id);
  await page.getByTestId('main-tab-menu').click();
  await waitForMenuReady();
  await page.waitForTimeout(50);
}

async function measureReopen() {
  const runs = [];
  const eventIndex = apiEvents.length;
  for (let index = 0; index < iterations; index += 1) {
    await page.getByTestId('main-tab-tables').click();
    const clickedAt = Date.now();
    await page.getByTestId('main-tab-menu').click();
    await waitForMenuReady();
    runs.push(Date.now() - clickedAt);
  }
  const catalogEvents = apiEvents.slice(eventIndex).filter(isCatalogEvent);
  return {
    ...summarizeNumbers(runs),
    runs,
    categoriesHttp: catalogEvents.filter((event) => event.path === '/merchant/categories').length,
    productsHttp: catalogEvents.filter((event) => event.path === '/merchant/products').length,
  };
}

async function measureTableSwitch() {
  await page.getByTestId('main-tab-tables').click();
  const eventIndex = apiEvents.length;
  await page.getByTestId(`table-card-${tables[1].id}`).click();
  const clickedAt = Date.now();
  await page.getByTestId('main-tab-menu').click();
  await waitForMenuReady();
  const catalogEvents = apiEvents.slice(eventIndex).filter(isCatalogEvent);
  return {
    uiReadyMs: Date.now() - clickedAt,
    categoriesHttp: catalogEvents.filter((event) => event.path === '/merchant/categories').length,
    productsHttp: catalogEvents.filter((event) => event.path === '/merchant/products').length,
  };
}

async function measureImageFanout() {
  await clearCatalogCache();
  const imageIndex = imageEvents.length;
  await page.goto(`${baseUrl}/tables/${tables[0].id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cashier-ready="true"]').waitFor();
  await waitForSelectedTable(tables[0].id);
  await page.waitForTimeout(1_500);
  const clickedAt = Date.now();
  await page.getByTestId('main-tab-menu').click();
  await waitForMenuReady();
  const readyAt = Date.now();
  const visibleProductCount = await page.locator('.table-ordering-product').evaluateAll((cards) => cards.filter((card) => {
    const cardRect = card.getBoundingClientRect();
    const scroller = card.closest('.table-ordering-products__scroller');
    if (!(scroller instanceof HTMLElement)) return false;
    const scrollRect = scroller.getBoundingClientRect();
    return cardRect.bottom > scrollRect.top && cardRect.top < scrollRect.bottom;
  }).length);
  const imageElements = await page.locator('.table-ordering-product img').count();
  const asyncDecodingImages = await page.locator('.table-ordering-product img[decoding="async"]').count();
  await page.waitForTimeout(Math.max(0, 2_000 - (Date.now() - clickedAt)));
  const atTwoSeconds = Date.now();
  const scroller = page.getByTestId('table-ordering-products-scroller');
  await scroller.evaluate(async (element) => {
    for (let top = 0; top <= element.scrollHeight; top += Math.max(1, element.clientHeight)) {
      element.scrollTop = top;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  });
  await page.waitForTimeout(imageDelayMs + 120);
  const eventualAt = Date.now();
  const images = imageEvents.slice(imageIndex);
  return {
    imageElements,
    visibleProductCount,
    immediateRequests: images.filter((event) => event.startedAt <= readyAt + 100).length,
    requestsWithin2s: images.filter((event) => event.startedAt <= atTwoSeconds).length,
    eventualRequestsAfterScroll: images.filter((event) => event.startedAt <= eventualAt).length,
    completedBeforeUiReady: images.filter((event) => event.completedAt > 0 && event.completedAt <= readyAt).length,
    asyncDecodingImages,
    layoutShift: await page.evaluate(() => window.__catalogPerfLayoutShift || 0),
    menuUiReadyBeforeImageCompletion: images.some((event) => event.startedAt <= readyAt && event.completedAt > readyAt),
    menuUiReadyWaitedForImages: false,
  };
}

async function measureResponsiveMenu() {
  const targets = [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ];
  const results = [];
  for (const target of targets) {
    await page.setViewportSize(target);
    await page.goto(`${baseUrl}/tables/${tables[0].id}?view=menu`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cashier-ready="true"]').waitFor();
    await waitForSelectedTable(tables[0].id);
    await waitForMenuReady();
    const geometry = await page.evaluate(() => {
      const workspace = document.querySelector('[data-testid="table-ordering-workspace"]');
      const scroller = document.querySelector('[data-testid="table-ordering-products-scroller"]');
      const firstProduct = document.querySelector('.table-ordering-product');
      const firstPrice = document.querySelector('.table-ordering-product__price');
      if (!(workspace instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !(firstProduct instanceof HTMLElement)) {
        return null;
      }
      const workspaceRect = workspace.getBoundingClientRect();
      const productRect = firstProduct.getBoundingClientRect();
      return {
        bodyHorizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        workspaceInsideViewport: workspaceRect.left >= -1 && workspaceRect.right <= window.innerWidth + 1,
        firstProductInsideScroller: productRect.left >= scroller.getBoundingClientRect().left - 1
          && productRect.right <= scroller.getBoundingClientRect().right + 1,
        firstProductClickable: firstProduct.getAttribute('aria-disabled') !== 'true'
          && productRect.width >= 44 && productRect.height >= 44,
        unitVisible: firstPrice?.textContent?.includes('/份') || false,
      };
    });
    assert.ok(geometry, `${target.width}x${target.height}: menu geometry must be available`);
    assert.equal(geometry.bodyHorizontalOverflowPx, 0, `${target.width}x${target.height}: body must not overflow horizontally`);
    assert.equal(geometry.workspaceInsideViewport, true, `${target.width}x${target.height}: menu must stay inside viewport`);
    assert.equal(geometry.firstProductInsideScroller, true, `${target.width}x${target.height}: product must stay inside scroller`);
    assert.equal(geometry.firstProductClickable, true, `${target.width}x${target.height}: product target must remain clickable`);
    assert.equal(geometry.unitVisible, true, `${target.width}x${target.height}: product unit must remain visible`);
    results.push({ viewport: `${target.width}x${target.height}`, ...geometry });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return results;
}

async function waitForMenuReady() {
  await page.getByTestId('table-ordering-workspace').waitFor();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.table-ordering-product').length === expected,
    products.length,
  );
  assert.equal(await page.locator('.table-ordering-product').count(), products.length);
}

async function waitForSelectedTable(tableId) {
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.classList.contains('table-card--selected'),
    `[data-testid="table-card-${tableId}"]`,
  );
}

async function clearCatalogCache() {
  await page.evaluate(() => {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.includes('catalog')) localStorage.removeItem(key);
    }
  });
}

function isCatalogEvent(event) {
  return event.path === '/merchant/categories' || event.path === '/merchant/products';
}

function summarizeRuns(runs) {
  return {
    ...summarizeNumbers(runs.map((run) => run.uiReadyMs)),
    categoriesHttp: runs.reduce((total, run) => total + run.categoriesHttp, 0),
    productsHttp: runs.reduce((total, run) => total + run.productsHttp, 0),
  };
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
