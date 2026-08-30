import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5178';
const browserChannel = process.env.CASHIER_BROWSER_CHANNEL || 'chrome';
const evidenceDirectory = process.env.CASHIER_D20_EVIDENCE_DIR?.trim() || '';
const stressMode = process.env.CASHIER_D20_STRESS === 'true';
const browserErrors = [];
const results = [];
const stressResults = [];

const viewports = [
  ['1920', { width: 1920, height: 1080 }],
  ['1600', { width: 1600, height: 900 }],
  ['1440', { width: 1440, height: 900 }],
  ['1366', { width: 1366, height: 768 }],
  ['1280-d20', { width: 1280, height: 800 }],
  ['1179-compact', { width: 1179, height: 800 }],
  ['1024-compact', { width: 1024, height: 768 }],
  ['430', { width: 430, height: 932 }],
  ['390', { width: 390, height: 844 }],
  ['375', { width: 375, height: 812 }],
];

const browser = await chromium.launch({
  channel: browserChannel === 'bundled' ? undefined : browserChannel,
  headless: true,
});

try {
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });

  for (const [label, viewport] of viewports) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    recordBrowserErrors(page, label);

    await enterDemoMenu(page);
    const geometry = await readGeometry(page);
    verifyGeometry(label, viewport, geometry);
    results.push({ label, viewport, ...geometry });

    if (label === '1280-d20') await verifyOpenCloseAndCategory(page);

    if (evidenceDirectory) {
      await page.screenshot({ path: `${evidenceDirectory}/${label}.png`, fullPage: false });
    }

    if (stressMode && ['1280-d20', '1024-compact', '390'].includes(label)) {
      const stressFixture = await inflateStressContent(page);
      const stressGeometry = await readGeometry(page);
      verifyGeometry(`${label}-stress`, viewport, stressGeometry);
      assert.equal(stressGeometry.productCount, 201, `${label}: stress menu must contain 201 products`);
      assert.ok(stressGeometry.categoryCount >= 24, `${label}: stress menu must contain long category coverage`);
      assert.equal(stressGeometry.billStressRowCount, 60, `${label}: stress bill must contain 60 rows`);
      stressResults.push({ label, viewport, stressFixture, ...stressGeometry });

      if (evidenceDirectory) {
        await page.screenshot({ path: `${evidenceDirectory}/${label}-stress.png`, fullPage: false });
      }
    }

    await context.close();
  }

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  const report = {
    result: 'PASS',
    mode: stressMode ? 'responsive-and-stress' : 'responsive',
    viewports: results,
    stressViewports: stressResults,
  };
  if (evidenceDirectory) {
    await writeFile(`${evidenceDirectory}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

async function enterDemoMenu(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('enter-demo').click();
  await page.waitForURL((url) => url.pathname === '/tables');
  await page.getByTestId('table-card-demo-table-10').click();
  await page.waitForURL((url) => url.pathname === '/tables/demo-table-10');
  const currentLocation = await page.evaluate(() => window.location.href);
  if (new URL(currentLocation).searchParams.get('view') !== 'menu') {
    await page.getByTestId('main-tab-menu').click();
    await page.waitForURL((url) => url.searchParams.get('view') === 'menu');
  }
  await page.getByTestId('table-ordering-workspace').waitFor();
  await page.locator('.table-ordering-product').first().waitFor();
}

function recordBrowserErrors(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`${label} page: ${error.message}`));
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const readRect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: (rect.left + rect.right) / 2,
        centerY: (rect.top + rect.bottom) / 2,
      };
    };

    const routeElement = document.querySelector('[data-testid="table-overview-workspace"]');
    const detailElement = document.querySelector('[data-testid="table-route-detail"]');
    const scrollerElement = document.querySelector('[data-testid="table-ordering-products-scroller"]');
    const categoryElement = document.querySelector('[data-testid="table-ordering-category-strip"]');
    const productViewportElement = document.querySelector('[data-testid="table-ordering-products-viewport"]');
    const productGridElement = document.querySelector('.table-ordering-product-grid');
    const routeStyle = routeElement instanceof HTMLElement ? getComputedStyle(routeElement) : null;
    const detailStyle = detailElement instanceof HTMLElement ? getComputedStyle(detailElement) : null;
    const readOriginStyle = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      return {
        justifyContent: style.justifyContent,
        alignContent: style.alignContent,
        justifyItems: style.justifyItems,
        alignItems: style.alignItems,
        margin: style.margin,
        maxWidth: style.maxWidth,
        transform: style.transform,
        zoom: style.zoom,
      };
    };

    return {
      appViewport: {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
        centerX: window.innerWidth / 2,
        centerY: window.innerHeight / 2,
      },
      route: readRect('[data-testid="table-overview-workspace"]'),
      mainPane: readRect('.cashier-workspace__content--table-overview'),
      menu: readRect('[data-testid="table-ordering-workspace"]'),
      menuProducts: readRect('.table-ordering-products'),
      productScroller: readRect('[data-testid="table-ordering-products-scroller"]'),
      categoryStrip: readRect('[data-testid="table-ordering-category-strip"]'),
      productViewport: readRect('[data-testid="table-ordering-products-viewport"]'),
      productGrid: readRect('.table-ordering-product-grid'),
      rightBillPane: readRect('[data-testid="table-route-detail"]'),
      productScrollerStyle: readOriginStyle(scrollerElement),
      categoryStripStyle: readOriginStyle(categoryElement),
      productViewportStyle: readOriginStyle(productViewportElement),
      productGridStyle: readOriginStyle(productGridElement),
      gridColumns: routeStyle?.gridTemplateColumns || '',
      detailPosition: detailStyle?.position || '',
      detailTransform: detailStyle?.transform || '',
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      productCount: document.querySelectorAll('.table-ordering-product').length,
      categoryCount: document.querySelectorAll('[data-testid="table-ordering-category-strip"] button').length,
      billStressRowCount: document.querySelectorAll('[data-d20-stress-bill-row]').length,
    };
  });
}

function verifyGeometry(label, viewport, geometry) {
  const {
    route, mainPane, menu, menuProducts, productScroller, categoryStrip,
    productViewport, productGrid, rightBillPane,
  } = geometry;
  assert.ok(route && mainPane && menu && rightBillPane, `${label}: required layout rectangles must exist`);
  assert.equal(geometry.horizontalOverflow, 0, `${label}: page must not overflow horizontally`);
  assert.ok(geometry.productCount > 0, `${label}: fixture menu must contain products`);

  const mainCenterDelta = Math.abs(menu.centerX - mainPane.centerX);
  const verticalCenterDelta = Math.abs(menu.centerY - mainPane.centerY);
  assert.ok(mainCenterDelta <= 1, `${label}: menu/main horizontal center delta ${mainCenterDelta}px exceeds 1px`);
  assert.ok(verticalCenterDelta <= 2, `${label}: menu/main vertical center delta ${verticalCenterDelta}px exceeds 2px`);
  assert.ok(menu.left >= mainPane.left - 1 && menu.right <= mainPane.right + 1, `${label}: menu must stay inside main pane`);

  if (viewport.width >= 900) {
    assert.ok(
      menuProducts && productScroller && categoryStrip && productViewport && productGrid,
      `${label}: desktop menu origin rectangles must exist`,
    );
    const menuLeftGap = menuProducts.left - mainPane.left;
    const menuTopGap = menuProducts.top - mainPane.top;
    const categoryLeftGap = categoryStrip.left - mainPane.left;
    const categoryTopGap = categoryStrip.top - mainPane.top;
    const scrollerToCategoryLeft = categoryStrip.left - productScroller.left;
    const scrollerToViewportLeft = productViewport.left - productScroller.left;
    const scrollerToGridLeft = productGrid.left - productScroller.left;
    assert.ok(menuLeftGap >= -1 && menuLeftGap <= 24, `${label}: desktop menu left origin gap ${menuLeftGap}px exceeds 24px`);
    assert.ok(menuTopGap >= -1 && menuTopGap <= 24, `${label}: desktop menu top origin gap ${menuTopGap}px exceeds 24px`);
    assert.ok(categoryLeftGap >= -1 && categoryLeftGap <= 24, `${label}: desktop category left origin gap ${categoryLeftGap}px exceeds 24px`);
    assert.ok(categoryTopGap >= -1 && categoryTopGap <= 24, `${label}: desktop category top origin gap ${categoryTopGap}px exceeds 24px`);
    assert.ok(Math.abs(scrollerToCategoryLeft) <= 1, `${label}: category/scroller left delta ${scrollerToCategoryLeft}px exceeds 1px`);
    assert.ok(Math.abs(scrollerToViewportLeft) <= 1, `${label}: viewport/scroller left delta ${scrollerToViewportLeft}px exceeds 1px`);
    assert.ok(Math.abs(scrollerToGridLeft) <= 1, `${label}: product grid/scroller left delta ${scrollerToGridLeft}px exceeds 1px`);
    assert.equal(geometry.productScrollerStyle?.justifyContent, 'stretch', `${label}: desktop scroller must stretch from its origin`);
    assert.equal(geometry.productScrollerStyle?.alignContent, 'start', `${label}: desktop scroller must align content to the top`);
    assert.equal(geometry.categoryStripStyle?.justifyContent, 'flex-start', `${label}: desktop categories must align left`);
    assert.equal(geometry.categoryStripStyle?.alignContent, 'start', `${label}: desktop categories must align top`);
    assert.equal(geometry.productGridStyle?.justifyContent, 'start', `${label}: desktop grid must align left`);
    assert.equal(geometry.productGridStyle?.alignContent, 'start', `${label}: desktop grid must align top`);
    for (const [name, style] of [
      ['scroller', geometry.productScrollerStyle],
      ['category strip', geometry.categoryStripStyle],
      ['product viewport', geometry.productViewportStyle],
      ['product grid', geometry.productGridStyle],
    ]) {
      assert.equal(style?.margin, '0px', `${label}: desktop ${name} must not have auto/offset margins`);
      assert.equal(style?.maxWidth, 'none', `${label}: desktop ${name} must not have a centered max-width`);
      assert.equal(style?.transform, 'none', `${label}: desktop ${name} must not use transform offsets`);
      assert.equal(style?.zoom, '1', `${label}: desktop ${name} must not use zoom offsets`);
    }
  }

  if (viewport.width >= 1180) {
    assert.equal(geometry.detailPosition, 'relative', `${label}: desktop right bill pane must remain in the grid`);
    assert.ok(mainPane.right <= rightBillPane.left + 1, `${label}: menu pane must not overlap right bill pane`);
  } else {
    const routeCenterDelta = Math.abs(menu.centerX - route.centerX);
    assert.equal(geometry.detailPosition, 'fixed', `${label}: compact/mobile right bill pane must remain a drawer`);
    assert.ok(routeCenterDelta <= 1, `${label}: menu/available route center delta ${routeCenterDelta}px exceeds 1px`);
    assert.ok(Math.abs(mainPane.width - route.width) <= 1, `${label}: hidden drawer must not reserve ${route.width - mainPane.width}px`);
  }
}

async function verifyOpenCloseAndCategory(page) {
  await page.getByTestId('main-tab-tables').click();
  await page.waitForURL((url) => url.searchParams.get('view') !== 'menu');
  await page.getByTestId('main-tab-menu').click();
  await page.waitForURL((url) => url.searchParams.get('view') === 'menu');
  await page.getByTestId('table-ordering-workspace').waitFor();

  const categories = page.getByTestId('table-ordering-category-strip').locator('button');
  if (await categories.count() > 1) {
    await categories.nth(1).click();
    assert.equal(await categories.nth(1).getAttribute('class'), 'is-active');
  }
}

async function inflateStressContent(page) {
  return page.evaluate(() => {
    const productGrid = document.querySelector('.table-ordering-product-grid');
    const productTemplate = productGrid?.querySelector('.table-ordering-product');
    if (!(productGrid instanceof HTMLElement) || !(productTemplate instanceof HTMLElement)) {
      throw new Error('Stress fixture requires a rendered product grid');
    }

    while (productGrid.querySelectorAll('.table-ordering-product').length < 201) {
      const index = productGrid.querySelectorAll('.table-ordering-product').length + 1;
      const product = productTemplate.cloneNode(true);
      if (!(product instanceof HTMLElement)) continue;
      product.removeAttribute('id');
      product.dataset.productId = `d20-stress-product-${index}`;
      const name = product.querySelector('.table-ordering-product__content strong');
      if (name) name.textContent = `超长菜品名称压力样本 ${index} / Món ăn tên dài kiểm thử`;
      productGrid.append(product);
    }

    const categoryStrip = document.querySelector('[data-testid="table-ordering-category-strip"]');
    const categoryTemplate = categoryStrip?.querySelector('button');
    if (!(categoryStrip instanceof HTMLElement) || !(categoryTemplate instanceof HTMLButtonElement)) {
      throw new Error('Stress fixture requires a rendered category strip');
    }

    while (categoryStrip.querySelectorAll('button').length < 24) {
      const index = categoryStrip.querySelectorAll('button').length + 1;
      const category = categoryTemplate.cloneNode(true);
      if (!(category instanceof HTMLButtonElement)) continue;
      category.classList.remove('is-active');
      category.textContent = `超长分类 ${index} · Danh mục rất dài`;
      categoryStrip.append(category);
    }

    const billBody = document.querySelector('[data-testid="right-panel-body"]');
    if (!(billBody instanceof HTMLElement)) throw new Error('Stress fixture requires a bill body');
    billBody.querySelector('[data-d20-stress-bill]')?.remove();
    const emptyBillState = billBody.querySelector('[data-testid="right-panel-empty-table"]');
    if (emptyBillState instanceof HTMLElement) emptyBillState.hidden = true;

    const stressBill = document.createElement('div');
    stressBill.dataset.d20StressBill = 'many';
    stressBill.className = 'table-bill-scroll';
    const stressBillList = document.createElement('div');
    stressBillList.className = 'table-item-summary-list';
    for (let index = 1; index <= 60; index += 1) {
      const row = document.createElement('article');
      row.dataset.d20StressBillRow = String(index);
      row.className = 'table-item-summary-row';

      const source = document.createElement('span');
      source.className = 'table-item-summary-row__source';
      source.textContent = '加菜';

      const name = document.createElement('div');
      name.className = 'table-item-summary-row__name';
      const strong = document.createElement('strong');
      strong.textContent = `压力账单菜品 ${index}`;
      name.append(strong);

      const stepper = document.createElement('div');
      stepper.className = 'committed-item-stepper';
      const decrease = document.createElement('button');
      decrease.type = 'button';
      decrease.textContent = '−';
      const quantity = document.createElement('output');
      quantity.textContent = '1';
      const increase = document.createElement('button');
      increase.type = 'button';
      increase.textContent = '+';
      stepper.append(decrease, quantity, increase);

      const price = document.createElement('b');
      price.className = 'table-item-summary-row__item-price';
      price.textContent = '999,999 ₫';

      row.append(source, name, stepper, price);
      stressBillList.append(row);
    }
    stressBill.append(stressBillList);
    billBody.append(stressBill);

    return {
      productCount: productGrid.querySelectorAll('.table-ordering-product').length,
      categoryCount: categoryStrip.querySelectorAll('button').length,
      billStressRowCount: stressBillList.children.length,
      emptyBillStatePreserved: Boolean(emptyBillState),
    };
  });
}
