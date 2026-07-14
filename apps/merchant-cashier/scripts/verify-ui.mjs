import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const browserErrors = [];
let deliberateOffline = false;

page.on('console', (message) => {
  if (message.type() === 'error') {
    const location = message.location().url;
    browserErrors.push(`console: ${message.text()}${location ? ` (${location})` : ''}`);
  }
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('requestfailed', (request) => {
  if (!deliberateOffline) {
    browserErrors.push(`request: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'failed'})`);
  }
});

try {
  await enterFixtureDemo();
  await selectFixtureTable();
  await verifyFixtureFacts();
  await verifyFinalShellContent();
  await verifyEmployeeMenu();

  const viewports = [
    [1536, 1024],
    [1366, 768],
    [1280, 800],
    [1024, 768],
    [820, 1180],
  ];

  for (const [width, height] of viewports) {
    await verifyViewport(width, height);
  }

  await verifyPrintIsDisabled();
  await verifyOrderFlow();
  await verifyNetworkRecovery();
  await verifyLocales();

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(
    'Verified the final operator layout at 1536x1024, 1366x768, 1280x800, '
      + '1024x768, and 820x1180, including fixture facts, employee menu, disabled '
      + 'printing, zh/vi/en overflow, order flow, and network recovery.\n',
  );
} finally {
  await browser.close();
}

async function enterFixtureDemo() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const demoEntry = page.getByTestId('enter-demo');
  assert.equal(
    await demoEntry.isVisible(),
    true,
    'Fixture demo entry is unavailable. Start Vite with VITE_CASHIER_USE_FIXTURES=true.',
  );
  await demoEntry.click();
  await page.waitForURL('**/tables');
  await page.getByTestId('table-grid').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function openTables() {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (new URL(page.url()).pathname !== '/tables') {
    await page.locator('a[href="/tables"]:visible').first().click();
    await page.waitForURL('**/tables');
  }
  await page.getByTestId('table-toolbar').waitFor();
}

async function selectFixtureTable() {
  await openTables();
  await page.getByTestId('table-card-demo-table-1').click();
  await page.getByTestId('table-detail').waitFor();
}

async function verifyFixtureFacts() {
  const expectedMetrics = {
    all: '15',
    available: '13',
    'in-use': '1',
    ready: '0',
    disabled: '1',
  };
  for (const [key, value] of Object.entries(expectedMetrics)) {
    assert.equal(
      (await page.getByTestId(`top-metric-${key}`).locator('strong').textContent())?.trim(),
      value,
      `Fixture top metric ${key} must come from the real fixture tables`,
    );
  }
  assert.match(
    (await page.getByTestId('top-new-orders').textContent()) || '',
    /3/,
    'Fixture must show its three real pending orders',
  );
  assert.equal(await page.locator('.table-card').count(), 15, 'All 15 fixture tables must render');
  assert.equal(await page.locator('.table-card[data-status="AVAILABLE"]').count(), 13);
  assert.equal(await page.locator('.table-card[data-status="IN_USE"]').count(), 1);
  assert.equal(await page.locator('.table-card[data-status="READY_TO_CLOSE"]').count(), 0);
  assert.equal(await page.locator('.table-card[data-status="DISABLED"]').count(), 1);

  const table = page.getByTestId('table-card-demo-table-1');
  assert.match((await table.textContent()) || '', /A01/);
  assert.match((await table.textContent()) || '', /3\s*笔订单/);
  assert.match(
    (await table.textContent()) || '',
    /—/,
    'Guest count is not available in the current API and must remain an explicit dash',
  );

  const detail = page.getByTestId('table-detail');
  assert.equal(await detail.locator('.bill-order-row').count(), 3, 'A01 must show its three real fixture orders');
  assert.match((await detail.textContent()) || '', /411[.,]?000/);
  assert.match((await detail.textContent()) || '', /仍有\s*2\s*笔未完成订单，不能关闭桌台/);

  const search = page.getByTestId('table-toolbar').locator('input[type="search"]');
  await search.fill('DEMO-1001');
  assert.equal(await page.locator('.table-card:visible').count(), 1, 'Order-number search must resolve to its table');
  assert.match((await page.locator('.table-card:visible').textContent()) || '', /A01/);
  await search.fill('');
}

async function verifyFinalShellContent() {
  const shell = page.locator('.cashier-shell');
  const sidebar = page.getByTestId('cashier-sidebar');
  const header = page.getByTestId('cashier-topbar');

  assert.equal(await page.getByTestId('cashier-brand').count(), 1, 'Yunqiao brand must appear once');
  assert.equal((await page.getByTestId('cashier-brand').textContent())?.trim(), 'Yunqiao');
  assert.equal(await sidebar.getByTestId('cashier-merchant-panel').count(), 1);
  assert.equal(await sidebar.locator('.cashier-navigation a').count(), 4);
  assert.equal(await sidebar.getByTestId('employee-menu-trigger').count(), 1);
  assert.equal(await header.locator('[data-testid="cashier-brand"]').count(), 0);
  assert.equal(await header.locator('[data-testid="cashier-merchant-panel"]').count(), 0);
  assert.equal(await header.locator('[data-testid="employee-menu"]').count(), 0);
  assert.equal(await header.getByTestId('top-metrics').count(), 1);
  assert.equal(await header.getByTestId('top-status').count(), 1);
  assert.equal(await header.getByTestId('top-network-status').count(), 1);
  assert.equal(await header.getByTestId('top-sound-status').count(), 1);
  assert.equal(await header.getByTestId('top-print-status').count(), 1);
  assert.equal(await header.getByTestId('top-fullscreen').count(), 1);
  assert.equal(await header.getByTestId('top-clock').count(), 1);

  for (const removedText of [
    '智慧收银管理',
    '高效经营 · 智能管理',
    '云桥收银台',
    'YUNQIAO CASHIER',
    '全部区域',
  ]) {
    assert.equal(
      await shell.getByText(removedText, { exact: true }).count(),
      0,
      `Removed final-layout copy remains: ${removedText}`,
    );
  }
  assert.equal(await page.getByTestId('table-toolbar').locator('.area-tabs').count(), 0);
}

async function verifyEmployeeMenu() {
  await page.setViewportSize({ width: 1280, height: 800 });
  const trigger = page.getByTestId('employee-menu-trigger');
  await trigger.click();
  const popover = page.getByTestId('employee-menu-popover');
  await popover.waitFor();
  assert.equal(await popover.locator(':scope > label').count(), 1, 'Employee menu needs one language row');
  assert.equal(await popover.locator(':scope > button').count(), 1, 'Employee menu needs one logout row');
  assert.equal(await popover.locator('select').count(), 1);
  assert.equal(await popover.locator('a').count(), 0, 'Employee menu must not contain navigation links');
  assert.equal(await popover.getByText('打开商家后台', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await popover.count(), 0, 'Escape must close the employee menu');

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByTestId('employee-menu-trigger').click();
  const compactIdentity = page.getByTestId('employee-menu-popover').locator('.account-menu__compact-identity');
  assert.equal(await compactIdentity.isVisible(), true, 'Collapsed tablet rail must expose merchant and employee identity');
  assert.match((await compactIdentity.textContent()) || '', /演示餐厅/);
  assert.match((await compactIdentity.textContent()) || '', /演示员工/);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function verifyViewport(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(120);

  const layout = await page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing layout element ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const overflowOf = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return 0;
      return Math.max(0, element.scrollWidth - element.clientWidth);
    };
    const tableGrid = document.querySelector('[data-testid="table-grid"]');
    const tableCards = [...document.querySelectorAll('.table-card')].filter(visible);
    const visibleBrands = [...document.querySelectorAll('[data-testid="cashier-brand"]')].filter(visible);
    const header = document.querySelector('[data-testid="cashier-topbar"]');
    const sidebar = document.querySelector('[data-testid="cashier-sidebar"]');
    const employee = document.querySelector('[data-testid="employee-menu-trigger"]');
    const merchant = document.querySelector('[data-testid="cashier-merchant-panel"]');
    const toolbar = document.querySelector('[data-testid="table-toolbar"]');
    const search = toolbar?.querySelector('.cashier-search');
    const statuses = toolbar?.querySelector('.status-filters');
    const refresh = toolbar?.querySelector('[data-testid="table-toolbar-refresh"]');
    if (!(tableGrid instanceof HTMLElement)
      || !(header instanceof HTMLElement)
      || !(sidebar instanceof HTMLElement)
      || !(employee instanceof HTMLElement)
      || !(merchant instanceof HTMLElement)
      || !(toolbar instanceof HTMLElement)
      || !(search instanceof HTMLElement)
      || !(statuses instanceof HTMLElement)
      || !(refresh instanceof HTMLElement)) {
      throw new Error('Final cashier shell is incomplete');
    }
    const columns = getComputedStyle(tableGrid).gridTemplateColumns.split(' ').filter(Boolean).length;
    const topItems = [...header.querySelectorAll('.cashier-top-metric, .top-status-item')].filter(visible);
    const overlappingTopItems = topItems.some((item, index) => {
      const current = item.getBoundingClientRect();
      return topItems.slice(index + 1).some((other) => {
        const candidate = other.getBoundingClientRect();
        return current.left < candidate.right - 1
          && current.right > candidate.left + 1
          && current.top < candidate.bottom - 1
          && current.bottom > candidate.top + 1;
      });
    });
    const searchRect = search.getBoundingClientRect();
    const statusesRect = statuses.getBoundingClientRect();
    const refreshRect = refresh.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const firstCard = tableCards[0]?.getBoundingClientRect();
    const route = document.querySelector('.cashier-shell__route');
    const detail = document.querySelector('.cashier-shell__detail');
    return {
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      shellOverflowX: overflowOf('.cashier-shell'),
      routeOverflowX: route instanceof HTMLElement ? route.scrollWidth - route.clientWidth : 0,
      toolbarOverflowX: toolbar.scrollWidth - toolbar.clientWidth,
      headerOverflowX: header.scrollWidth - header.clientWidth,
      brandCount: visibleBrands.length,
      headerBrandCount: visibleBrands.filter((brand) => {
        const rect = brand.getBoundingClientRect();
        return rect.left >= headerRect.left - 1
          && rect.right <= headerRect.right + 1
          && rect.top >= headerRect.top - 1
          && rect.bottom <= headerRect.bottom + 1;
      }).length,
      headerMerchantCount: header.querySelectorAll('[data-testid="cashier-merchant-panel"]').length,
      headerEmployeeCount: header.querySelectorAll('[data-testid="employee-menu"]').length,
      sidebarBrandVisible: visible(document.querySelector('[data-testid="cashier-brand"]')),
      sidebarMerchantVisible: visible(merchant),
      sidebarEmployeeVisible: visible(employee),
      navLinkCount: [...sidebar.querySelectorAll('.cashier-navigation a')].filter(visible).length,
      mobileNavVisible: visible(document.querySelector('.cashier-mobile-navigation')),
      shell: rectOf('.cashier-shell'),
      sidebar: rectOf('[data-testid="cashier-sidebar"]'),
      header: rectOf('[data-testid="cashier-topbar"]'),
      route: rectOf('.cashier-shell__route'),
      detail: detail instanceof HTMLElement ? rectOf('.cashier-shell__detail') : null,
      brand: rectOf('[data-testid="cashier-brand"]'),
      merchant: rectOf('[data-testid="cashier-merchant-panel"]'),
      employee: rectOf('[data-testid="employee-menu-trigger"]'),
      nav: rectOf('.cashier-navigation'),
      toolbar: rectOf('[data-testid="table-toolbar"]'),
      search: { x: searchRect.x, y: searchRect.y, width: searchRect.width, height: searchRect.height },
      statuses: { x: statusesRect.x, y: statusesRect.y, width: statusesRect.width, height: statusesRect.height },
      refresh: { x: refreshRect.x, y: refreshRect.y, width: refreshRect.width, height: refreshRect.height },
      toolbarOneRow: Math.abs(searchRect.top - statusesRect.top) <= 1
        && Math.abs(statusesRect.top - refreshRect.top) <= 1,
      tableColumns: columns,
      firstCard: firstCard
        ? { x: firstCard.x, y: firstCard.y, width: firstCard.width, height: firstCard.height }
        : null,
      topItemsOverlap: overlappingTopItems,
    };
  });

  assert.ok(layout.documentOverflowX <= 1, `${width}x${height}: document overflows horizontally`);
  assert.ok(layout.documentOverflowY <= 1, `${width}x${height}: document overflows vertically`);
  assert.ok(layout.shellOverflowX <= 1, `${width}x${height}: shell overflows horizontally`);
  assert.ok(layout.routeOverflowX <= 1, `${width}x${height}: route overflows horizontally`);
  assert.ok(layout.toolbarOverflowX <= 1, `${width}x${height}: toolbar overflows horizontally`);
  assert.ok(layout.headerOverflowX <= 1, `${width}x${height}: top bar overflows horizontally`);
  assert.equal(layout.brandCount, 1, `${width}x${height}: exactly one Yunqiao brand must be visible`);
  assert.equal(layout.headerMerchantCount, 0, `${width}x${height}: merchant panel leaked into top bar`);
  assert.equal(layout.headerEmployeeCount, 0, `${width}x${height}: employee card leaked into top bar`);
  assert.equal(layout.topItemsOverlap, false, `${width}x${height}: top status items overlap`);
  assert.equal(layout.mobileNavVisible, width < 900, `${width}x${height}: wrong navigation mode`);

  if (width >= 900) {
    assert.equal(layout.headerBrandCount, 0, `${width}x${height}: brand must stay in the left rail`);
    assert.equal(layout.sidebarBrandVisible, true, `${width}x${height}: left brand is missing`);
    assert.equal(layout.navLinkCount, 4, `${width}x${height}: left navigation is incomplete`);
    assert.equal(layout.toolbarOneRow, true, `${width}x${height}: toolbar must stay on one row`);
    assert.equal(layout.tableColumns, 4, `${width}x${height}: table grid must use four columns`);
  } else {
    assert.equal(layout.headerBrandCount, 1, `${width}x${height}: compact brand must occupy the top-left`);
    assert.equal(layout.navLinkCount, 0, `${width}x${height}: desktop navigation must collapse below 900px`);
    assert.ok(layout.tableColumns >= 2 && layout.tableColumns <= 3, `${width}x${height}: compact grid needs 2–3 columns`);
  }

  if (width >= 1366) {
    assertBetween(layout.sidebar.width, 224, 248, `${width}x${height}: left rail width`);
    assertBetween(layout.detail?.width ?? 0, 350, 376, `${width}x${height}: detail width`);
  }

  if (width === 1536 && height === 1024) {
    assertNear(layout.sidebar.width, 248, 4, '1536: left rail width');
    assertNear(layout.header.height, 108, 4, '1536: top bar height');
    assertNear(layout.detail?.width ?? 0, 376, 4, '1536: detail width');
    assertNear(layout.brand.x, 24, 4, '1536: brand x');
    assertNear(layout.brand.y, 20, 4, '1536: brand y');
    assertNear(layout.merchant.x, 24, 4, '1536: merchant x');
    assertNear(layout.merchant.y, 128, 4, '1536: merchant y');
    assertNear(layout.nav.x, 12, 4, '1536: navigation x');
    assertNear(layout.nav.y, 252, 4, '1536: navigation y');
    assertNear(layout.employee.x, 20, 4, '1536: employee x');
    assertNear(layout.employee.y, 902, 4, '1536: employee y');
    assertNear(layout.firstCard?.width ?? 0, 198, 4, '1536: table card width');
    assertNear(layout.firstCard?.height ?? 0, 154, 4, '1536: table card height');
  }

  if (width === 1280 && height === 800) {
    assertNear(layout.sidebar.width, 206, 2, 'D10: left rail width');
    assertNear(layout.header.height, 84, 2, 'D10: top bar height');
    assertNear(layout.route.width, 764, 2, 'D10: central workspace width');
    assertNear(layout.detail?.width ?? 0, 310, 2, 'D10: detail width');
    assertNear(layout.brand.x, 18, 2, 'D10: brand x');
    assertNear(layout.brand.y, 14, 2, 'D10: brand y');
    assertNear(layout.brand.width, 172, 2, 'D10: brand width');
    assertNear(layout.brand.height, 54, 2, 'D10: brand height');
    assertNear(layout.merchant.x, 18, 2, 'D10: merchant x');
    assertNear(layout.merchant.y, 88, 2, 'D10: merchant y');
    assertNear(layout.merchant.width, 172, 2, 'D10: merchant width');
    assertNear(layout.merchant.height, 82, 2, 'D10: merchant height');
    assertNear(layout.nav.x, 10, 2, 'D10: navigation x');
    assertNear(layout.nav.y, 190, 2, 'D10: navigation y');
    assertNear(layout.nav.width, 186, 2, 'D10: navigation width');
    assertNear(layout.employee.x, 16, 2, 'D10: employee x');
    assertNear(layout.employee.y, 710, 2, 'D10: employee y');
    assertNear(layout.employee.width, 174, 2, 'D10: employee width');
    assertNear(layout.employee.height, 72, 2, 'D10: employee height');
    assertNear(layout.toolbar.x, 218, 2, 'D10: toolbar x');
    assertNear(layout.toolbar.y, 96, 2, 'D10: toolbar y');
    assertNear(layout.toolbar.width, 740, 2, 'D10: toolbar width');
    assertNear(layout.toolbar.height, 52, 2, 'D10: toolbar height');
    assertBetween(layout.search.width, 278, 300, 'D10: search width');
    assertNear(layout.search.height, 44, 2, 'D10: search height');
    assert.ok(layout.statuses.width <= 384, `D10: status filter is too wide (${layout.statuses.width}px)`);
    assertNear(layout.statuses.height, 44, 2, 'D10: status height');
    assertNear(layout.refresh.width, 44, 2, 'D10: refresh width');
    assertNear(layout.refresh.height, 44, 2, 'D10: refresh height');
    assertNear(layout.firstCard?.x ?? 0, 218, 2, 'D10: first table card x');
    assertNear(layout.firstCard?.y ?? 0, 162, 2, 'D10: first table card y');
    assertBetween(layout.firstCard?.width ?? 0, 174, 178, 'D10: table card width');
    assertBetween(layout.firstCard?.height ?? 0, 122, 126, 'D10: table card height');
    assert.equal(layout.sidebarMerchantVisible, true, 'D10: merchant panel is missing');
    assert.equal(layout.sidebarEmployeeVisible, true, 'D10: employee card is missing');
  }
}

async function verifyPrintIsDisabled() {
  await selectFixtureTable();
  const printButton = page.getByTestId('table-print-disabled');
  assert.equal(await printButton.isDisabled(), true, 'Table bill print must be disabled in V1');
  assert.match((await printButton.textContent()) || '', /打印桌账/);
  assert.equal(await printButton.getAttribute('aria-describedby'), 'table-print-tooltip');
  const tooltipTrigger = page.getByTestId('table-print-tooltip-trigger');
  assert.match((await tooltipTrigger.getAttribute('data-tooltip')) || '', /打印功能待接入/);
  await tooltipTrigger.hover();
  const tooltip = page.locator('#table-print-tooltip');
  await tooltip.waitFor();
  assert.match((await tooltip.textContent()) || '', /打印功能待接入/);
  assert.equal(await page.locator('[data-testid*="print"][href]').count(), 0, 'No print navigation may be exposed');
}

async function verifyOrderFlow() {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('a[href="/orders/history"]:visible').first().click();
  await page.waitForURL('**/orders/history');
  assert.equal(await page.locator('input[type="date"]').count(), 1);
  assert.equal(await page.locator('.compact-field select').count(), 1);

  await page.locator('a[href="/orders/new"]:visible').first().click();
  await page.waitForURL('**/orders/new');
  await page.locator('.order-card').first().click();
  await page.getByRole('button', { name: '拒单', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '接单', exact: true }).click();
  await page.getByText('订单状态已更新。').waitFor();
}

async function verifyNetworkRecovery() {
  await openTables();
  deliberateOffline = true;
  await context.setOffline(true);
  const networkStatus = page.getByTestId('top-network-status');
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="top-network-status"]');
    return element?.classList.contains('top-status-item--danger');
  });
  assert.match((await networkStatus.textContent()) || '', /网络异常/);
  await context.setOffline(false);
  deliberateOffline = false;
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="top-network-status"]');
    return element?.classList.contains('top-status-item--ok')
      || element?.classList.contains('top-status-item--warning');
  });
  assert.equal(await page.getByTestId('table-grid').isVisible(), true, 'Table data must survive network recovery');
}

async function verifyLocales() {
  await openTables();
  for (const locale of ['vi', 'en', 'zh']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('employee-menu-trigger').click();
    const popover = page.getByTestId('employee-menu-popover');
    await popover.locator('select').selectOption(locale);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      (expectedLocale) => document.documentElement.lang === expectedLocale,
      locale === 'zh' ? 'zh-CN' : locale,
    );

    for (const [width, height] of [[1280, 800], [820, 1180]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => {
        const horizontalOverflow = (element) => element instanceof HTMLElement
          ? element.scrollWidth - element.clientWidth
          : 0;
        const header = document.querySelector('[data-testid="cashier-topbar"]');
        const toolbar = document.querySelector('[data-testid="table-toolbar"]');
        const sidebar = document.querySelector('[data-testid="cashier-sidebar"]');
        const shortLabels = [...document.querySelectorAll('.top-status-item__label--short')]
          .filter((element) => getComputedStyle(element).display !== 'none');
        const statusButtons = [...document.querySelectorAll('[data-testid="table-toolbar"] .status-filters button')];
        return {
          documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          documentY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          headerX: horizontalOverflow(header),
          toolbarX: horizontalOverflow(toolbar),
          sidebarX: horizontalOverflow(sidebar),
          statusLabelX: Math.max(0, ...shortLabels.map(horizontalOverflow)),
          statusButtonX: Math.max(0, ...statusButtons.map(horizontalOverflow)),
        };
      });
      assert.ok(overflow.documentX <= 1, `${locale} ${width}x${height}: document overflows horizontally`);
      assert.ok(overflow.documentY <= 1, `${locale} ${width}x${height}: document overflows vertically`);
      assert.ok(overflow.headerX <= 1, `${locale} ${width}x${height}: top bar labels overflow`);
      assert.ok(overflow.toolbarX <= 1, `${locale} ${width}x${height}: toolbar labels overflow`);
      assert.ok(overflow.sidebarX <= 1, `${locale} ${width}x${height}: left identity content overflows`);
      assert.ok(overflow.statusLabelX <= 1, `${locale} ${width}x${height}: top short labels overflow`);
      assert.ok(overflow.statusButtonX <= 1, `${locale} ${width}x${height}: table state labels overflow`);
    }
  }
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}±${tolerance}px, got ${actual}px`,
  );
}

function assertBetween(actual, minimum, maximum, label) {
  assert.ok(
    actual >= minimum && actual <= maximum,
    `${label}: expected ${minimum}–${maximum}px, got ${actual}px`,
  );
}
