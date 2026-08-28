import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5178';
const outputDirectory = process.env.CASHIER_SCREENSHOT_OUTPUT
  || '/Users/peter/Desktop/云桥Life-发布与交付/06-UI优化/YunQiao-Cashier-Mobile-UI-20260828-V6-FINAL/evidence';
const browserChannel = process.env.CASHIER_BROWSER_CHANNEL || 'chrome';
const tableFirstCardTopBefore = 109;
const mobileViewports = [
  ['375', { width: 375, height: 812 }],
  ['390', { width: 390, height: 844 }],
  ['430', { width: 430, height: 932 }],
];
const desktopViewports = [
  ['1366x768', { width: 1366, height: 768 }],
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
];
const browserErrors = [];
const metrics = { mobile: {}, desktop: {} };
let mobileScreenshotCount = 0;

await mkdir(outputDirectory, { recursive: true });
await mkdir(`${outputDirectory}/desktop`, { recursive: true });
const browser = await chromium.launch({
  channel: browserChannel === 'bundled' ? undefined : browserChannel,
  headless: true,
});

try {
  for (const [label, viewport] of mobileViewports) {
    const directory = `${outputDirectory}/${label}`;
    await mkdir(directory, { recursive: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    recordBrowserErrors(page, label);

    await enterDemo(page);
    const tableMetrics = await readTableMetrics(page);
    assert.equal(tableMetrics.searchCount, 0);
    assert.equal(tableMetrics.currentTableCount, 0);
    assert.equal(tableMetrics.refreshCount, 0);
    assert.equal(tableMetrics.newOrderCount, 0);
    assert.equal(tableMetrics.statusActionCount, 3);
    assert.deepEqual(tableMetrics.statusActions, ['network', 'sound', 'printer']);
    assert.equal(tableMetrics.filterCount, 3);
    assert.equal(tableMetrics.duplicateFilterCount, 0);
    assert.equal(tableMetrics.filterRowCount, 1);
    assert.ok(tableMetrics.firstCardTop < tableFirstCardTopBefore);
    assert.equal(tableMetrics.documentOverflow, 0);
    await shot(page, directory, '01-table-header');
    await shot(page, directory, '02-table-first-row');

    await page.getByTestId('mobile-table-filter-in-use').click();
    await page.waitForURL((url) => url.searchParams.get('status') === 'IN_USE');
    assert.equal(await page.getByTestId('mobile-table-filter-in-use').getAttribute('aria-pressed'), 'true');
    await shot(page, directory, '03-table-filter-active');
    await page.getByTestId('mobile-table-filter-all').click();
    await page.waitForURL((url) => !url.searchParams.has('status'));

    await page.getByTestId('table-card-demo-table-10').click();
    await page.waitForURL((url) => url.pathname === '/tables/demo-table-10' && url.searchParams.get('view') === 'menu');
    await page.getByTestId('table-ordering-workspace').waitFor();
    await page.locator('.table-ordering-product').first().waitFor();
    const menuMetrics = await readMenuMetrics(page);
    assert.equal(menuMetrics.searchCount, 1);
    assert.equal(menuMetrics.newOrderCount, 1);
    assert.equal(menuMetrics.statusActionCount, 4);
    assert.equal(menuMetrics.tableFilterCount, 0);
    assert.equal(menuMetrics.refreshCount, 0);
    assert.equal(menuMetrics.currentTableTag, 'OUTPUT');
    assert.equal(menuMetrics.currentTableTabIndex, -1);
    assert.equal(menuMetrics.currentTableChevronCount, 0);
    assert.ok(menuMetrics.searchWidth > menuMetrics.currentTableWidth);
    assert.equal(menuMetrics.searchFontSize, 16);
    assert.equal(menuMetrics.searchFocusBoxShadow, 'none');
    assert.equal(menuMetrics.productGridColumns, 4);
    assert.equal(menuMetrics.bottomNavCount, 4);
    assert.equal(menuMetrics.documentOverflow, 0);
    assert.ok(menuMetrics.topGap >= 0 && menuMetrics.topGap <= 8);
    await shot(page, directory, '04-menu-header');
    await shot(page, directory, '05-menu-table-readonly');

    const categoryMetrics = await exerciseOverflowingCategories(page);
    assert.equal(categoryMetrics.rowCount, 1);
    assert.equal(categoryMetrics.flexWrap, 'nowrap');
    assert.equal(categoryMetrics.overflowX, 'auto');
    assert.equal(categoryMetrics.overflowY, 'hidden');
    assert.equal(categoryMetrics.scrollbarWidth, 'none');
    assert.ok(categoryMetrics.scrollWidth > categoryMetrics.clientWidth);
    assert.ok(categoryMetrics.previousWrappedHeight > categoryMetrics.height);
    assert.equal(categoryMetrics.stickyOwnerPosition, 'sticky');
    await page.getByTestId('table-ordering-category-strip').evaluate((element) => { element.scrollLeft = 0; });
    await shot(page, directory, '06-category-one-line-start');
    await page.getByTestId('table-ordering-category-strip').evaluate((element) => {
      element.scrollLeft = Math.round((element.scrollWidth - element.clientWidth) / 2);
    });
    await shot(page, directory, '07-category-scroll-middle');
    const endVisibility = await clickEndCategory(page);
    assert.equal(endVisibility.active, true);
    assert.equal(endVisibility.fullyVisible, true);
    assert.ok(endVisibility.scrollLeft > 0);
    await shot(page, directory, '08-category-scroll-end');

    const stickyMetrics = await assertStickyCategory(page);
    assert.equal(stickyMetrics.windowScrollY, 0);
    assert.ok(Math.abs(stickyMetrics.beforeTop - stickyMetrics.afterTop) < 0.5);
    await shot(page, directory, '09-product-grid-4-col');

    const firstProduct = page.locator('.table-ordering-product').first();
    await firstProduct.click();
    await page.waitForFunction(() => document.querySelector('.table-ordering-product__quick-add output')?.textContent?.trim() === 'X1');
    await firstProduct.click();
    await page.waitForFunction(() => document.querySelector('.table-ordering-product__quick-add output')?.textContent?.trim() === 'X2');
    assert.equal(await page.locator('.table-ordering-product__quick-add output').first().textContent(), 'X2');
    await shot(page, directory, '10-product-x2');

    metrics.mobile[label] = {
      viewport,
      tableFirstCardTopBefore,
      table: tableMetrics,
      menu: menuMetrics,
      category: categoryMetrics,
      sticky: stickyMetrics,
    };
    await context.close();
  }

  assert.equal(mobileScreenshotCount, 30);

  for (const [label, viewport] of desktopViewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    recordBrowserErrors(page, `desktop-${label}`);
    await enterDemo(page);
    await page.getByTestId('table-card-demo-table-1').click();
    await page.waitForURL((url) => url.pathname === '/tables/demo-table-1');
    await page.getByTestId('main-tab-menu').click();
    await page.waitForURL((url) => url.searchParams.get('view') === 'menu');
    await page.getByTestId('table-ordering-workspace').waitFor();
    const desktopMetrics = await readDesktopMetrics(page);
    assert.equal(desktopMetrics.headerHeight, 78);
    assert.equal(desktopMetrics.mobileToolbarDisplay, 'none');
    assert.equal(desktopMetrics.mobileFilterCount, 0);
    assert.equal(desktopMetrics.productGridColumns, 5);
    assert.equal(desktopMetrics.stepperButtonCount, 2);
    assert.equal(desktopMetrics.stepperHeight, 44);
    assert.equal(desktopMetrics.documentOverflow, 0);
    await page.screenshot({ path: `${outputDirectory}/desktop/${label}-menu.png`, animations: 'disabled' });
    metrics.desktop[label] = { viewport, ...desktopMetrics };
    await context.close();
  }

  assert.equal(browserErrors.length, 0, `browser console/page errors:\n${browserErrors.join('\n')}`);
  metrics.mobileScreenshotCount = mobileScreenshotCount;
  metrics.result = 'PASS';
  await writeFile(`${outputDirectory}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  process.stdout.write(`CASHIER_MOBILE_HEADER_ROUTE_SPLIT_V6_FINAL_ACCEPTANCE=PASS screenshots=${mobileScreenshotCount} output=${outputDirectory}\n`);
  process.stdout.write(`${JSON.stringify(metrics)}\n`);
} finally {
  await browser.close();
}

async function enterDemo(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('enter-demo').click();
  await page.waitForURL((url) => url.pathname === '/tables');
  await page.getByTestId('table-grid').waitFor();
}

function recordBrowserErrors(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`${label} page: ${error.message}`));
}

async function shot(page, directory, name) {
  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
  mobileScreenshotCount += 1;
}

async function readTableMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.cashier-header');
    const firstCard = document.querySelector('[data-testid^="table-card-"]');
    const filters = [...document.querySelectorAll('[data-testid="cashier-mobile-table-filters"] button')];
    const status = document.querySelector('[data-testid="top-status"]');
    const statusMap = [
      ['top-network-status', 'network'],
      ['top-sound-status', 'sound'],
      ['top-print-status', 'printer'],
    ];
    return {
      tableHeaderHeight: header?.getBoundingClientRect().height || 0,
      firstCardTop: firstCard?.getBoundingClientRect().top || 0,
      searchCount: document.querySelectorAll('[data-testid="cashier-mobile-ordering-toolbar"]').length,
      currentTableCount: document.querySelectorAll('[data-testid="cashier-mobile-current-table"]').length,
      refreshCount: document.querySelectorAll('[data-testid="top-table-refresh"], [data-testid="table-main-refresh"]').length,
      newOrderCount: document.querySelectorAll('[data-testid="top-new-orders"]').length,
      statusActionCount: status?.children.length || 0,
      statusActions: statusMap.filter(([testId]) => document.querySelector(`[data-testid="${testId}"]`)).map(([, name]) => name),
      filterCount: filters.length,
      duplicateFilterCount: document.querySelectorAll('.table-main-toolbar').length,
      filterRowCount: new Set(filters.map((button) => Math.round(button.getBoundingClientRect().top))).size,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function readMenuMetrics(page) {
  const search = page.locator('#cashier-mobile-menu-search input[type="search"]');
  await search.focus();
  return page.evaluate(() => {
    const header = document.querySelector('.cashier-header');
    const toolbar = document.querySelector('[data-testid="cashier-mobile-ordering-toolbar"]');
    const currentTable = document.querySelector('[data-testid="cashier-mobile-current-table"]');
    const category = document.querySelector('[data-testid="table-ordering-category-strip"]');
    const firstProduct = document.querySelector('.table-ordering-product');
    const searchInput = document.querySelector('#cashier-mobile-menu-search input[type="search"]');
    const workspace = document.querySelector('.table-ordering-workspace--embedded');
    const grid = document.querySelector('.table-ordering-product-grid');
    const searchStyle = searchInput ? getComputedStyle(searchInput) : null;
    return {
      menuHeaderHeight: header?.getBoundingClientRect().height || 0,
      searchCount: document.querySelectorAll('#cashier-mobile-menu-search input[type="search"]').length,
      newOrderCount: document.querySelectorAll('[data-testid="top-new-orders"]').length,
      statusActionCount: document.querySelector('[data-testid="top-status"]')?.children.length || 0,
      tableFilterCount: document.querySelectorAll('[data-testid="cashier-mobile-table-filters"]').length,
      refreshCount: document.querySelectorAll('[data-testid="top-table-refresh"], [data-testid="table-main-refresh"]').length,
      currentTableTag: currentTable?.tagName || '',
      currentTableTabIndex: currentTable?.tabIndex ?? 0,
      currentTableChevronCount: currentTable?.querySelectorAll('svg').length || 0,
      searchWidth: toolbar?.getBoundingClientRect().width || 0,
      currentTableWidth: currentTable?.getBoundingClientRect().width || 0,
      searchFontSize: Number.parseFloat(searchStyle?.fontSize || '0'),
      searchFocusBoxShadow: searchStyle?.boxShadow || '',
      categoryBarHeight: category?.getBoundingClientRect().height || 0,
      firstProductTop: firstProduct?.getBoundingClientRect().top || 0,
      productGridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      bottomNavCount: document.querySelector('.cashier-mobile-navigation')?.children.length || 0,
      topGap: (workspace?.getBoundingClientRect().top || 0) - (header?.getBoundingClientRect().bottom || 0),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function exerciseOverflowingCategories(page) {
  return page.getByTestId('table-ordering-category-strip').evaluate((strip) => {
    const existing = [...strip.querySelectorAll('button')];
    const end = existing.at(-1);
    for (const label of ['面食', '汤品', '甜点', '小吃', '海鲜', '烧烤', '套餐', '时令菜']) {
      const clone = existing[0].cloneNode(true);
      clone.textContent = label;
      clone.removeAttribute('class');
      clone.setAttribute('data-v6-acceptance-clone', 'true');
      strip.insertBefore(clone, end);
    }
    if (end) strip.append(end);
    const previous = {
      flexWrap: strip.style.flexWrap,
      overflow: strip.style.overflow,
      whiteSpace: strip.style.whiteSpace,
    };
    strip.style.flexWrap = 'wrap';
    strip.style.overflow = 'visible';
    strip.style.whiteSpace = 'normal';
    const previousWrappedHeight = strip.getBoundingClientRect().height;
    strip.style.flexWrap = previous.flexWrap;
    strip.style.overflow = previous.overflow;
    strip.style.whiteSpace = previous.whiteSpace;
    const style = getComputedStyle(strip);
    const rowCount = new Set([...strip.querySelectorAll('button')].map((button) => Math.round(button.getBoundingClientRect().top))).size;
    return {
      height: strip.getBoundingClientRect().height,
      previousWrappedHeight,
      rowCount,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollbarWidth: style.scrollbarWidth,
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
      stickyOwnerPosition: getComputedStyle(strip.closest('.table-ordering-header')).position,
    };
  });
}

async function clickEndCategory(page) {
  const strip = page.getByTestId('table-ordering-category-strip');
  const button = strip.locator('button:not([data-v6-acceptance-clone])').last();
  await button.click();
  return button.evaluate((element) => {
    const parent = element.parentElement;
    const buttonRect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return {
      active: element.classList.contains('is-active'),
      fullyVisible: buttonRect.left >= parentRect.left - 0.5 && buttonRect.right <= parentRect.right + 0.5,
      scrollLeft: parent.scrollLeft,
    };
  });
}

async function assertStickyCategory(page) {
  const beforeTop = await page.getByTestId('table-ordering-category-strip').evaluate((element) => element.getBoundingClientRect().top);
  await page.getByTestId('table-ordering-products-scroller').evaluate((element) => { element.scrollTop = 260; });
  const afterTop = await page.getByTestId('table-ordering-category-strip').evaluate((element) => element.getBoundingClientRect().top);
  return { beforeTop, afterTop, windowScrollY: await page.evaluate(() => window.scrollY) };
}

async function readDesktopMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.cashier-header');
    const mobileToolbar = document.querySelector('[data-testid="cashier-mobile-ordering-toolbar"]');
    const grid = document.querySelector('.table-ordering-product-grid');
    const stepper = document.querySelector('.committed-item-stepper');
    return {
      headerHeight: header?.getBoundingClientRect().height || 0,
      mobileToolbarDisplay: mobileToolbar ? getComputedStyle(mobileToolbar).display : 'none',
      mobileFilterCount: document.querySelectorAll('[data-testid="cashier-mobile-table-filters"]').length,
      productGridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      stepperButtonCount: stepper?.querySelectorAll('button').length || 0,
      stepperWidth: stepper?.getBoundingClientRect().width || 0,
      stepperHeight: stepper?.getBoundingClientRect().height || 0,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}
