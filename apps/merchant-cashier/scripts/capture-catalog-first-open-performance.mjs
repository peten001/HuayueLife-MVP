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
const imageObserverMode = process.env.CASHIER_CATALOG_IMAGE_OBSERVER_MODE || 'native';
const preSourceError = process.env.CASHIER_CATALOG_PRE_SOURCE_ERROR === '1';
const cacheOnly = process.env.CASHIER_CATALOG_CACHE_ONLY === '1';

assert.ok(outputDirectory, 'CASHIER_CATALOG_PERF_OUTPUT is required');
assert.ok(Number.isInteger(iterations) && iterations >= 5, 'At least 5 iterations are required');
assert.ok(['native', 'stalled', 'disabled'].includes(imageObserverMode), 'Invalid image observer mode');

const apiEvents = [];
const imageEvents = [];
const browserErrors = [];
const expectedAbortedImageUrls = new Set();
let imageFailureMode = 'none';
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
await context.addInitScript(({ observerMode, dispatchPreSourceError }) => {
  window.__catalogPerfLayoutShift = 0;
  window.__cashierImageAssignments = [];
  window.__cashierImageMountedAt = new WeakMap();
  window.__cashierImageLifecycle = [];
  window.__cashierPreSourceErrors = [];
  window.__cashierIoTrace = [];
  window.__cashierLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__catalogPerfLayoutShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // LayoutShift is not available in every browser build.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__cashierLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // LongTask is not available in every browser build.
  }

  const recordMountedImage = (image) => {
    if (!(image instanceof HTMLImageElement) || window.__cashierImageMountedAt.has(image)) return;
    window.__cashierImageMountedAt.set(image, performance.now());
  };
  const recordAssignedImage = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    const src = image.getAttribute('src');
    if (!src || !src.includes('catalog-perf-product-')) return;
    if (window.__cashierImageAssignments.some((entry) => entry.image === image && entry.src === src)) return;
    const assignedAt = performance.now();
    const assignment = {
      image,
      src,
      assignedAt,
      assignedAfterMountMs: assignedAt - (window.__cashierImageMountedAt.get(image) ?? assignedAt),
      decodedAt: null,
      decodeFailed: false,
    };
    window.__cashierImageAssignments.push(assignment);
    image.decode().then(() => {
      assignment.decodedAt = performance.now();
    }).catch(() => {
      assignment.decodeFailed = true;
    });
  };
  const scheduledPreSourceErrors = new WeakSet();
  const schedulePreSourceError = (image) => {
    if (!dispatchPreSourceError || !(image instanceof HTMLImageElement) || scheduledPreSourceErrors.has(image)) return;
    scheduledPreSourceErrors.add(image);
    setTimeout(() => {
      if (
        !image.isConnected
        || image.hasAttribute('src')
        || image.dataset.loadState !== 'deferred'
      ) return;
      const entry = {
        alt: image.alt,
        stateBefore: image.dataset.loadState,
        hiddenBefore: image.hidden,
        stateAfter: null,
        hiddenAfter: null,
      };
      image.dispatchEvent(new Event('error'));
      entry.stateAfter = image.dataset.loadState;
      entry.hiddenAfter = image.hidden;
      window.__cashierPreSourceErrors.push(entry);
    }, 0);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') recordAssignedImage(record.target);
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        recordMountedImage(node);
        recordAssignedImage(node);
        schedulePreSourceError(node);
        node.querySelectorAll?.('img').forEach((image) => {
          recordMountedImage(image);
          recordAssignedImage(image);
          schedulePreSourceError(image);
        });
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  document.addEventListener('load', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const src = image.getAttribute('src');
    if (!src?.includes('catalog-perf-product-')) return;
    window.__cashierImageLifecycle.push({ image, src, loadedAt: performance.now() });
  }, true);

  const NativeIntersectionObserver = window.IntersectionObserver;
  if (observerMode === 'disabled') {
    window.IntersectionObserver = undefined;
  } else if (NativeIntersectionObserver) {
    window.IntersectionObserver = class TracedIntersectionObserver {
      constructor(callback, options = {}) {
        this.root = options.root || null;
        this.rootMargin = options.rootMargin || '0px';
        this.thresholds = Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold ?? 0];
        this.trace = {
          rootClass: this.root instanceof Element ? this.root.className : null,
          rootMargin: this.rootMargin,
          thresholds: this.thresholds,
          rootRectAtCreation: this.root instanceof Element
            ? rectToJson(this.root.getBoundingClientRect())
            : null,
          observedCount: 0,
          callbacks: [],
          disconnectCount: 0,
        };
        window.__cashierIoTrace.push(this.trace);
        this.native = new NativeIntersectionObserver((entries) => {
          this.trace.callbacks.push({
            at: performance.now(),
            total: entries.length,
            intersecting: entries.filter((entry) => entry.isIntersecting).length,
            scrollTop: this.root instanceof HTMLElement ? this.root.scrollTop : null,
            rootBounds: entries[0]?.rootBounds ? rectToJson(entries[0].rootBounds) : null,
          });
          if (observerMode !== 'stalled') callback(entries, this);
        }, options);
      }

      observe(element) {
        this.trace.observedCount += 1;
        this.native.observe(element);
      }

      unobserve(element) {
        this.native.unobserve(element);
      }

      disconnect() {
        this.trace.disconnectCount += 1;
        this.native.disconnect();
      }

      takeRecords() {
        return this.native.takeRecords();
      }
    };
  }

  function rectToJson(rect) {
    return {
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
}, { observerMode: imageObserverMode, dispatchPreSourceError: preSourceError });
const page = await context.newPage();

page.on('console', (message) => {
  if (imageFailureMode !== 'none' && message.text().includes('status of 503')) return;
  if (imageFailureMode === 'offline' && message.text().includes('ERR_INTERNET_DISCONNECTED')) return;
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('requestfailed', (request) => {
  if (expectedAbortedImageUrls.delete(request.url())) return;
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
    const shouldAbort = imageFailureMode === 'offline';
    const shouldFail = imageFailureMode === 'all'
      || (imageFailureMode === 'first' && url.pathname.includes('catalog-perf-product-1.svg'));
    const event = {
      url: url.pathname,
      startedAt: Date.now(),
      completedAt: 0,
      status: shouldAbort ? 0 : shouldFail ? 503 : 200,
    };
    imageEvents.push(event);
    await delay(imageDelayMs);
    event.completedAt = Date.now();
    if (shouldAbort) {
      expectedAbortedImageUrls.add(request.url());
      await route.abort('internetdisconnected');
      return;
    }
    await route.fulfill({
      status: event.status,
      contentType: 'image/svg+xml',
      body: shouldFail
        ? ''
        : '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e9f4ef"/><circle cx="320" cy="240" r="120" fill="#36a270"/></svg>',
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
  let result;
  if (cacheOnly) {
    await primeCatalog();
    const persistentReload = [];
    for (let index = 0; index < iterations; index += 1) {
      persistentReload.push(await measureFirstOpen({ waitBeforeOpenMs: 0, clearCatalog: false }));
    }
    const persistentSummary = summarizeRuns(persistentReload);
    assert.ok(persistentSummary.p95 <= 200, `Persistent MENU_UI_READY p95 must be <=200ms, got ${persistentSummary.p95}ms`);
    assert.equal(persistentSummary.categoriesHttp, 0, 'Persistent reload must not request categories');
    assert.equal(persistentSummary.productsHttp, 0, 'Persistent reload must not request products');
    result = {
      label,
      generatedAt: new Date().toISOString(),
      configuration: { iterations, imageObserverMode, preSourceError, cacheOnly },
      persistentReload: persistentSummary,
      runs: persistentReload,
      reopen: await measureReopen(),
      tableSwitch: await measureTableSwitch(),
      browserErrors,
    };
  } else if (process.env.CASHIER_CATALOG_CRITIQUE_ONLY === '1') {
    result = {
      label,
      generatedAt: new Date().toISOString(),
      uiCritique: await captureUiCritique(),
      browserErrors,
    };
  } else {
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
    const mobileImageRegression = await measureMobileImageRegression();
    const interactionScrollRegression = await measureInteractionScrollRegression();
    result = {
      label,
      generatedAt: new Date().toISOString(),
      configuration: {
        products: products.length,
        categories: categories.length,
        iterations,
        catalogDelayMs,
        bootstrapDelayMs,
        imageDelayMs,
        imageObserverMode,
        preSourceError,
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
      mobileImageRegression,
      interactionScrollRegression,
      browserErrors,
    };
  }
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

async function measureMobileImageRegression() {
  const targets = [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 375, height: 812 },
  ];
  const results = [];
  for (const target of targets) {
    const runs = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await page.setViewportSize(target);
      await page.goto(`${baseUrl}/tables`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-cashier-ready="true"]').waitFor();
      const targetTable = page.getByTestId(`table-card-${tables[0].id}`);
      await targetTable.waitFor();
      await page.evaluate(() => {
        window.__cashierImageAssignments = [];
        window.__cashierImageLifecycle = [];
        window.__cashierIoTrace = [];
        window.__cashierLongTasks = [];
      });
      const apiIndex = apiEvents.length;
      const imageIndex = imageEvents.length;
      const clickedAt = Date.now();
      const clickedAtPerformance = await page.evaluate(() => performance.now());
      await targetTable.click();
      await waitForSelectedTable(tables[0].id);
      await waitForMenuReady();
      const samples = {};
      for (const sampleMs of [100, 500, 2_000]) {
        await page.waitForTimeout(Math.max(0, sampleMs - (Date.now() - clickedAt)));
        samples[sampleMs] = await captureMobileImageSample(clickedAtPerformance);
        samples[sampleMs].requestCount = imageEvents.slice(imageIndex)
          .filter((event) => event.startedAt <= clickedAt + sampleMs).length;
      }
      // Attribute long tasks to the scroll loader separately from initial menu rendering.
      await page.evaluate(() => { window.__cashierLongTasks = []; });
      const scroller = page.getByTestId('table-ordering-products-scroller');
      const checkpoints = [];
      let previousSrcCount = 0;
      for (let percent = 0; percent <= 100; percent += 10) {
        if (percent > 0) {
          await scroller.evaluate((element, nextPercent) => {
            element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * nextPercent / 100);
          }, percent);
          // Let the current scroll frame and its deliberately delayed image responses settle.
          // A separate quick-jump scenario below covers fast flicks without this pacing.
          await page.waitForTimeout(Math.max(160, imageDelayMs + 40));
        }
        const checkpoint = await captureFullScrollCheckpoint();
        checkpoint.requestCount = imageEvents.slice(imageIndex).length;
        assert.equal(
          checkpoint.visibleWithSrc,
          checkpoint.visibleImageCount,
          `${target.width}px ${percent}%: every visible image must have src`,
        );
        assert.ok(
          checkpoint.cumulativeSrcCount >= previousSrcCount,
          `${target.width}px ${percent}%: cumulative src count must be monotonic`,
        );
        previousSrcCount = checkpoint.cumulativeSrcCount;
        checkpoints.push({ percent, ...checkpoint });
      }
      await page.waitForTimeout(imageDelayMs + 100);
      const fullScroll = await captureFullScrollCheckpoint();
      fullScroll.requestCount = imageEvents.slice(imageIndex).length;
      const catalogEvents = apiEvents.slice(apiIndex).filter(isCatalogEvent);
      assert.ok(
        samples[2_000].totalWithSrc < samples[2_000].totalImageNodes,
        `${target.width}px: no-scroll state must not assign every image`,
      );
      assert.equal(fullScroll.cumulativeSrcCount, fullScroll.totalImageCount, `${target.width}px: full scroll must cover all images`);
      assert.ok(fullScroll.scrollMetrics.longestFrameMs < 8, `${target.width}px: longest scroll callback must stay below 8ms`);
      assert.equal(fullScroll.longTasks.length, 0, `${target.width}px: scroll phase must not produce long tasks`);
      runs.push({
        samples,
        checkpoints,
        afterOneScreen: checkpoints[1],
        fullScroll,
        categoriesHttp: catalogEvents.filter((event) => event.path === '/merchant/categories').length,
        productsHttp: catalogEvents.filter((event) => event.path === '/merchant/products').length,
      });
    }
    const assignmentTiming = {
      initialP95Ms: summarizeNumbers(runs.map((run) => run.samples[100].initialAssignmentP95Ms)).p95,
      item21P95Ms: summarizeNumbers(runs.map((run) => run.samples[100].item21AssignmentMs)).p95,
    };
    assert.ok(
      assignmentTiming.initialP95Ms !== null && assignmentTiming.initialP95Ms <= 100,
      `${target.width}px: initial image src assignment p95 must be <=100ms, got ${assignmentTiming.initialP95Ms}ms`,
    );
    assert.ok(
      assignmentTiming.item21P95Ms !== null && assignmentTiming.item21P95Ms <= 100,
      `${target.width}px: item21 src assignment p95 must be <=100ms, got ${assignmentTiming.item21P95Ms}ms`,
    );
    await openMobileMenu(target);
    await page.evaluate(() => {
      window.__cashierImageAssignments = [];
      window.__cashierImageLifecycle = [];
      window.__cashierIoTrace = [];
      window.__cashierLongTasks = [];
    });
    const quickJumpScroller = page.getByTestId('table-ordering-products-scroller');
    await quickJumpScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight;
    });
    await page.waitForTimeout(280);
    const quickJump = await captureFullScrollCheckpoint();
    assert.equal(
      quickJump.visibleWithSrc,
      quickJump.visibleImageCount,
      `${target.width}px quick jump: settle fallback must fill the current viewport`,
    );
    assert.ok(quickJump.scrollMetrics.longestFrameMs < 8, `${target.width}px quick jump must stay below 8ms`);
    assert.equal(quickJump.longTasks.length, 0, `${target.width}px quick jump must not produce long tasks`);
    results.push({ viewport: `${target.width}x${target.height}`, runs, assignmentTiming, quickJump });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return results;
}

async function captureFullScrollCheckpoint() {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="table-ordering-products-scroller"]');
    if (!(scroller instanceof HTMLElement)) throw new Error('Missing product scroller');
    const rootRect = scroller.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.table-ordering-product')];
    const images = [...document.querySelectorAll('.table-ordering-product img')];
    const visibleCardIndexes = cards
      .map((card, index) => ({ index, rect: card.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > rootRect.top && rect.top < rootRect.bottom)
      .map(({ index }) => index);
    const visibleImages = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
    });
    const hasSrc = (image) => Boolean(image.getAttribute('src'));
    const metrics = scroller.__cashierCatalogImageScrollMetrics || {
      samples: [],
      frameCount: 0,
      settleCount: 0,
      longestFrameMs: 0,
      lastExaminedCount: 0,
      lastReleasedCount: 0,
    };
    const observerCallbacks = (window.__cashierIoTrace || []).flatMap((trace) => trace.callbacks || []);
    return {
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      visibleCardIndexes,
      visibleImageCount: visibleImages.length,
      visibleWithSrc: visibleImages.filter(hasSrc).length,
      visibleLoaded: visibleImages.filter((image) => image.complete && image.naturalWidth > 0 && !image.hidden).length,
      stuckVisibleNoSrc: visibleImages.filter((image) => !hasSrc(image)).length,
      cumulativeSrcCount: images.filter(hasSrc).length,
      totalImageCount: images.length,
      observerCallbackCount: observerCallbacks.length,
      observerEntryCount: observerCallbacks.reduce((total, callback) => total + callback.total, 0),
      lastObserverScrollTop: observerCallbacks.at(-1)?.scrollTop ?? null,
      scrollMetrics: {
        samples: [...metrics.samples],
        frameCount: metrics.frameCount,
        settleCount: metrics.settleCount,
        longestFrameMs: metrics.longestFrameMs,
        lastExaminedCount: metrics.lastExaminedCount,
        lastReleasedCount: metrics.lastReleasedCount,
      },
      longTasks: [...(window.__cashierLongTasks || [])],
      preSourceErrors: [...(window.__cashierPreSourceErrors || [])],
      bodyHorizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
}

async function measureInteractionScrollRegression() {
  const target = { width: 390, height: 844 };
  await openMobileMenu(target);
  const categoryButtons = page.locator('[data-testid="table-ordering-category-strip"] button');
  await categoryButtons.nth(1).click();
  await page.waitForFunction(() => {
    const count = document.querySelectorAll('.table-ordering-product').length;
    return count > 20 && count < 201;
  });
  const categoryScroller = page.getByTestId('table-ordering-products-scroller');
  await categoryScroller.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  await page.waitForTimeout(280);
  const category = await captureFullScrollCheckpoint();

  await categoryButtons.nth(0).click();
  const search = page.getByTestId('table-ordering-search').locator('input');
  await search.fill('性能测试菜品1');
  await page.waitForFunction(() => {
    const count = document.querySelectorAll('.table-ordering-product').length;
    return count > 20 && count < 201;
  });
  const searchScroller = page.getByTestId('table-ordering-products-scroller');
  await searchScroller.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  await page.waitForTimeout(280);
  const searchResult = await captureFullScrollCheckpoint();

  await search.fill('');
  const reopenApiIndex = apiEvents.length;
  await page.getByRole('link', { name: '桌台总览' }).click();
  await page.getByTestId(`table-card-${tables[0].id}`).click();
  await waitForSelectedTable(tables[0].id);
  await waitForMenuReady();
  const reopenScroller = page.getByTestId('table-ordering-products-scroller');
  await reopenScroller.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  await page.waitForTimeout(280);
  const reopen = await captureFullScrollCheckpoint();
  const reopenCatalog = apiEvents.slice(reopenApiIndex).filter(isCatalogEvent);

  await page.getByRole('link', { name: '桌台总览' }).click();
  const tableApiIndex = apiEvents.length;
  await page.getByTestId(`table-card-${tables[1].id}`).click();
  await waitForSelectedTable(tables[1].id);
  await waitForMenuReady();
  const tableScroller = page.getByTestId('table-ordering-products-scroller');
  await tableScroller.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  await page.waitForTimeout(280);
  const tableSwitch = await captureFullScrollCheckpoint();
  const tableCatalog = apiEvents.slice(tableApiIndex).filter(isCatalogEvent);

  for (const [name, result] of Object.entries({ category, searchResult, reopen, tableSwitch })) {
    assert.equal(result.visibleWithSrc, result.visibleImageCount, `${name}: visible image src coverage must be 100%`);
  }

  return {
    category,
    search: searchResult,
    reopen: {
      ...reopen,
      categoriesHttp: reopenCatalog.filter((event) => event.path === '/merchant/categories').length,
      productsHttp: reopenCatalog.filter((event) => event.path === '/merchant/products').length,
    },
    tableSwitch: {
      ...tableSwitch,
      categoriesHttp: tableCatalog.filter((event) => event.path === '/merchant/categories').length,
      productsHttp: tableCatalog.filter((event) => event.path === '/merchant/products').length,
    },
  };
}

async function captureMobileImageSample(clickedAtPerformance) {
  return page.evaluate((clickAt) => {
    const scroller = document.querySelector('[data-testid="table-ordering-products-scroller"]');
    if (!(scroller instanceof HTMLElement)) return null;
    const rootRect = scroller.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll('.table-ordering-product'));
    const withImages = cards.filter((card) => card.querySelector('img'));
    const visible = withImages.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
    });
    const srcAssigned = (card) => Boolean(card.querySelector('img')?.getAttribute('src'));
    const assignments = window.__cashierImageAssignments || [];
    const lifecycle = window.__cashierImageLifecycle || [];
    const resources = performance.getEntriesByType('resource');
    const assignmentAfterEligibility = (card) => {
      const image = card.querySelector('img');
      const assignment = assignments.find((entry) => entry.image === image);
      return assignment?.assignedAfterMountMs ?? null;
    };
    const initialAssignmentSamples = withImages.slice(0, 20)
      .map(assignmentAfterEligibility)
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const initialAssignmentP95Ms = initialAssignmentSamples.length
      ? initialAssignmentSamples[Math.min(
        initialAssignmentSamples.length - 1,
        Math.ceil(initialAssignmentSamples.length * 0.95) - 1,
      )]
      : null;
    const item21AssignmentMs = withImages[20] ? assignmentAfterEligibility(withImages[20]) : null;
    const details = withImages.slice(0, 10).map((card, index) => {
      const image = card.querySelector('img');
      const rect = image?.getBoundingClientRect();
      const assignment = assignments.find((entry) => entry.image === image);
      const loaded = lifecycle.find((entry) => entry.image === image && entry.src === image?.getAttribute('src'));
      const resource = resources.find((entry) => entry.name.includes(image?.getAttribute('src') || '__missing__'));
      const style = image ? getComputedStyle(image) : null;
      return {
        index,
        hasSrc: Boolean(image?.getAttribute('src')),
        loading: image?.getAttribute('loading') || null,
        decoding: image?.getAttribute('decoding') || null,
        loadReason: image?.dataset.loadReason || null,
        hidden: image?.hidden || false,
        visible: Boolean(image && rect && !image.hidden && style?.display !== 'none' && style?.visibility !== 'hidden'
          && rect.bottom > rootRect.top && rect.top < rootRect.bottom),
        complete: image?.complete || false,
        naturalWidth: image?.naturalWidth || 0,
        rect: rect ? {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null,
        assignedAfterClickMs: assignment ? Math.round(assignment.assignedAt - clickAt) : null,
        assignedAfterMountMs: assignment ? Math.round(assignment.assignedAfterMountMs) : null,
        requestStartedAfterClickMs: resource ? Math.round(resource.startTime - clickAt) : null,
        responseCompletedAfterClickMs: resource ? Math.round(resource.responseEnd - clickAt) : null,
        loadedAfterClickMs: loaded ? Math.round(loaded.loadedAt - clickAt) : null,
        decodedAfterClickMs: assignment?.decodedAt ? Math.round(assignment.decodedAt - clickAt) : null,
      };
    });
    document.body.dataset.beforeScrollSrcCount = String(withImages.filter(srcAssigned).length);
    return {
      visibleImageNodes: visible.length,
      visibleWithSrc: visible.filter(srcAssigned).length,
      visibleLoaded: visible.filter((card) => {
        const image = card.querySelector('img');
        return image?.complete && image.naturalWidth > 0 && !image.hidden;
      }).length,
      visibleSrcPercent: visible.length ? Math.round(visible.filter(srcAssigned).length / visible.length * 100) : 100,
      totalImageNodes: withImages.length,
      totalWithSrc: withImages.filter(srcAssigned).length,
      initialAssignmentP95Ms,
      item21AssignmentMs,
      scroller: {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        scrollTop: scroller.scrollTop,
        overflowY: getComputedStyle(scroller).overflowY,
        rect: {
          top: Math.round(rootRect.top),
          bottom: Math.round(rootRect.bottom),
          width: Math.round(rootRect.width),
          height: Math.round(rootRect.height),
        },
      },
      observer: (window.__cashierIoTrace || []).map((trace) => ({ ...trace })),
      details,
      layoutShift: window.__catalogPerfLayoutShift || 0,
      preSourceErrors: [...(window.__cashierPreSourceErrors || [])],
      bodyHorizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  }, clickedAtPerformance);
}

async function captureUiCritique() {
  await mkdir(outputDirectory, { recursive: true });
  const viewports = [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 375, height: 812 },
  ];
  const defaultStates = [];
  for (const viewport of viewports) {
    await openMobileMenu(viewport);
    await page.waitForTimeout(imageDelayMs + 120);
    const state = await captureMobileImageSample(await page.evaluate(() => performance.now()));
    if (preSourceError) {
      assert.ok(state.preSourceErrors.length > 0, `${viewport.width}px must dispatch deferred pre-source errors`);
      assert.ok(
        state.preSourceErrors.every((entry) => entry.stateAfter === 'deferred' && entry.hiddenAfter === false),
        `${viewport.width}px deferred pre-source errors must remain visible and deferred`,
      );
    }
    await page.screenshot({
      path: `${outputDirectory}/${label}-${viewport.width}-default.png`,
      fullPage: false,
    });
    const scroller = page.getByTestId('table-ordering-products-scroller');
    const slowScrollCoverage = [];
    for (const percent of [25, 50, 75, 100]) {
      await scroller.evaluate((element, nextPercent) => {
        element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * nextPercent / 100);
      }, percent);
      await page.waitForTimeout(imageDelayMs + 80);
      const checkpoint = await captureFullScrollCheckpoint();
      assert.equal(
        checkpoint.visibleWithSrc,
        checkpoint.visibleImageCount,
        `${viewport.width}px UI critique ${percent}%: visible images must have src`,
      );
      slowScrollCoverage.push({
        percent,
        visible: `${checkpoint.visibleWithSrc}/${checkpoint.visibleImageCount}`,
        cumulativeSrcCount: checkpoint.cumulativeSrcCount,
        stuckVisibleNoSrc: checkpoint.stuckVisibleNoSrc,
      });
      if (percent === 50 || percent === 100) {
        await page.screenshot({
          path: `${outputDirectory}/${label}-${viewport.width}-${percent === 50 ? 'middle' : 'bottom'}.png`,
          fullPage: false,
        });
      }
    }
    defaultStates.push({
      viewport: `${viewport.width}x${viewport.height}`,
      visibleImageNodes: state.visibleImageNodes,
      visibleWithSrc: state.visibleWithSrc,
      visibleLoaded: state.visibleLoaded,
      bodyHorizontalOverflowPx: state.bodyHorizontalOverflowPx,
      preSourceErrorCount: state.preSourceErrors.length,
      slowScrollCoverage,
    });
  }

  await openMobileMenu({ width: 390, height: 844 });
  const quickJumpScroller = page.getByTestId('table-ordering-products-scroller');
  await quickJumpScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await page.waitForTimeout(280);
  const quickJump = await captureFullScrollCheckpoint();
  assert.equal(quickJump.visibleWithSrc, quickJump.visibleImageCount, 'UI critique quick jump must fill viewport');
  await page.screenshot({ path: `${outputDirectory}/${label}-390-quick-bottom.png`, fullPage: false });

  await openMobileMenu({ width: 390, height: 844 });
  const categoryButtons = page.locator('[data-testid="table-ordering-category-strip"] button');
  await categoryButtons.nth(2).click();
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('.table-ordering-product');
    return cards.length > 0 && cards.length < 201
      && [...cards].filter((card) => card.querySelector('img')).every((card) => card.querySelector('img')?.hasAttribute('src'));
  });
  await page.waitForTimeout(imageDelayMs + 80);
  const categoryState = await captureMobileImageSample(await page.evaluate(() => performance.now()));
  await page.screenshot({ path: `${outputDirectory}/${label}-390-category.png`, fullPage: false });

  await page.getByTestId('table-ordering-search').locator('input').fill('性能测试菜品002');
  await page.waitForFunction(() => document.querySelectorAll('.table-ordering-product').length === 1);
  await page.waitForTimeout(imageDelayMs + 80);
  const searchState = await captureMobileImageSample(await page.evaluate(() => performance.now()));
  await page.screenshot({ path: `${outputDirectory}/${label}-390-search.png`, fullPage: false });

  imageFailureMode = 'first';
  await openMobileMenu({ width: 390, height: 844 });
  await page.waitForTimeout(imageDelayMs + 120);
  const imageErrorState = await page.evaluate(() => {
    const firstImage = document.querySelector('.table-ordering-product img');
    const firstPlaceholder = document.querySelector('.table-ordering-product .table-ordering-product__image svg');
    return {
      failedImageHidden: firstImage instanceof HTMLImageElement && firstImage.hidden,
      placeholderPresent: firstPlaceholder instanceof SVGElement,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  await page.screenshot({ path: `${outputDirectory}/${label}-390-image-error.png`, fullPage: false });

  imageFailureMode = 'offline';
  await openMobileMenu({ width: 390, height: 844 });
  await page.waitForTimeout(imageDelayMs + 120);
  const offlineState = await page.evaluate(() => ({
    visiblePlaceholderCards: [...document.querySelectorAll('.table-ordering-product')].filter((card) => {
      const root = document.querySelector('[data-testid="table-ordering-products-scroller"]');
      if (!(root instanceof HTMLElement)) return false;
      const rootRect = root.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return rect.bottom > rootRect.top
        && rect.top < rootRect.bottom
        && card.querySelector('.table-ordering-product__image svg') instanceof SVGElement;
    }).length,
    placeholders: document.querySelectorAll('.table-ordering-product__image svg').length,
  }));
  assert.ok(offlineState.visiblePlaceholderCards > 0, 'Offline state must show visible placeholders');
  await page.screenshot({ path: `${outputDirectory}/${label}-390-offline.png`, fullPage: false });

  imageFailureMode = 'none';
  await openMobileMenu({ width: 390, height: 844 });
  await page.waitForTimeout(imageDelayMs + 120);
  const onlineRecovery = await captureFullScrollCheckpoint();
  assert.equal(
    onlineRecovery.visibleLoaded,
    onlineRecovery.visibleImageCount,
    'New menu session must recover after network returns',
  );
  await page.screenshot({ path: `${outputDirectory}/${label}-390-online-recovery.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });

  return {
    defaultStates,
    category: {
      visibleImageNodes: categoryState.visibleImageNodes,
      visibleWithSrc: categoryState.visibleWithSrc,
      bodyHorizontalOverflowPx: categoryState.bodyHorizontalOverflowPx,
    },
    search: {
      resultImageNodes: searchState.totalImageNodes,
      resultWithSrc: searchState.totalWithSrc,
      bodyHorizontalOverflowPx: searchState.bodyHorizontalOverflowPx,
    },
    quickJump: {
      visible: `${quickJump.visibleWithSrc}/${quickJump.visibleImageCount}`,
      stuckVisibleNoSrc: quickJump.stuckVisibleNoSrc,
      settleCount: quickJump.scrollMetrics.settleCount,
    },
    imageError: imageErrorState,
    offlineToOnline: {
      ...offlineState,
      recoveredVisible: `${onlineRecovery.visibleLoaded}/${onlineRecovery.visibleImageCount}`,
    },
  };
}

async function openMobileMenu(viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}/tables`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cashier-ready="true"]').waitFor();
  const targetTable = page.getByTestId(`table-card-${tables[0].id}`);
  await targetTable.waitFor();
  await targetTable.click();
  await waitForSelectedTable(tables[0].id);
  await waitForMenuReady();
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
