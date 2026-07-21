import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

if (!process.env.VITE_CASHIER_USE_FIXTURES) {
  process.env.VITE_CASHIER_USE_FIXTURES = 'true';
}

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const orderingShotDir = '/tmp/cashier-ordering-responsive-shots';
mkdirSync(orderingShotDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const browserErrors = [];
let deliberateOffline = false;
const orderingLocaleCopy = {
  zh: {
    openTable: '开台点菜',
    openTableOnly: '仅开台',
    openTableAndAddItems: '确认开台并点菜',
    openSuccess: '开台成功。',
    openAndAddSuccess: '开台并点菜成功。',
    increaseQuantity: '增加数量',
  },
  vi: {
    openTable: 'Mở bàn và gọi món',
    openTableOnly: 'Chỉ mở bàn',
    openTableAndAddItems: 'Mở bàn và gọi món',
    openSuccess: 'Đã mở bàn.',
    openAndAddSuccess: 'Đã mở bàn và tạo đơn.',
    increaseQuantity: 'Tăng số lượng',
  },
  en: {
    openTable: 'Open Table & Order',
    openTableOnly: 'Open table only',
    openTableAndAddItems: 'Open Table & Add Items',
    openSuccess: 'Table opened.',
    openAndAddSuccess: 'Open and add items succeeded.',
    increaseQuantity: 'Increase quantity',
  },
};

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
  await verifyPwaManifestAndNavigation();

    const viewports = [
    [1366, 768],
    [1280, 800],
    [1180, 800],
    [1024, 768],
    [820, 1180],
    [768, 1024],
    [430, 932],
    [390, 844],
    [375, 812],
    [360, 800],
  ];

  for (const [width, height] of viewports) {
    await verifyViewport(width, height);
  }

  await verifyPrintIsDisabled();
  await verifyTableOrderingWorkspace();
  await verifyOrderingLayoutShots();
  await verifyOrderFlow();
  await verifyNetworkRecovery();
  await verifyLocales();
  await verifyAndroidWebViewLandscape();

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(
    'Verified the final operator layout at 1366x768, 1280x800, 1180x800, 1024x768, 820x1180, 768x1024, '
      + '430x932, 390x844, 375x812, and 360x800, including fixture facts, employee menu, disabled printing, '
      + 'table ordering, zh/vi/en overflow, order flow, and network recovery.\n',
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
    const tableNav = page.locator('a[href="/tables"]:visible').first();
    await tableNav.click();
    await page.waitForURL('**/tables');
  }
  await page.getByTestId('table-toolbar').waitFor();
}

async function selectFixtureTable() {
  await openTables();
  await page.getByTestId('table-card-demo-table-1').click();
  await page.getByTestId('table-detail').waitFor();
}

async function selectAvailableTableCard() {
  await openTables();
  const available = page.locator('.table-card[data-status="AVAILABLE"]');
  const count = await available.count();
  assert.ok(count > 0, 'Need at least one AVAILABLE fixture table');
  for (let index = 0; index < Math.min(count, 4); index += 1) {
    const card = available.nth(index);
    await card.scrollIntoViewIfNeeded();
    await card.click();
    try {
      await page.getByTestId('table-detail').waitFor({ timeout: 3000 });
      return;
    } catch {
      if (index === count - 1 || index === 3) break;
    }
    await card.click({ force: true });
    try {
      await page.getByTestId('table-detail').waitFor({ timeout: 3000 });
      return;
    } catch {
      // continue trying another table card
    }
  }
  throw new Error('Unable to open an AVAILABLE table detail card');
}

async function verifyFixtureFacts() {
  const expectedMetrics = {
    all: '15',
    available: '13',
    'in-use': '1',
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
  assert.equal(
    await detail.getByTestId('table-summary-tab').getAttribute('aria-selected'),
    'true',
    'Table detail must default to item summary',
  );
  assert.ok(await detail.locator('.table-item-summary-row').count() > 0, 'A01 must show its item summary');
  await detail.getByTestId('table-orders-tab').click();
  assert.equal(await detail.locator('.bill-order-row').count(), 3, 'A01 must show its three real fixture orders');
  await detail.getByTestId('table-summary-tab').click();
  assert.match((await detail.textContent()) || '', /411[.,]?000/);
  assert.match((await detail.textContent()) || '', /仍有\s*2\s*笔订单未完成，暂不能关闭桌台/);
  assert.equal(await detail.locator('.print-job-actions').count(), 0, 'Standalone print card must be absent');

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
  assert.equal((await page.getByTestId('account-role-label').textContent())?.trim(), '经理');
  assert.equal((await page.getByTestId('account-role-account-label').textContent())?.trim(), '管理账号');
  assert.equal((await trigger.textContent())?.includes('演示员工'), false, 'Employee nickname must not appear');
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
  assert.equal(await compactIdentity.isVisible(), true, 'Collapsed tablet rail must expose merchant and role identity');
  assert.match((await compactIdentity.textContent()) || '', /演示餐厅/);
  assert.match((await compactIdentity.textContent()) || '', /经理/);
  assert.match((await compactIdentity.textContent()) || '', /管理账号/);
  assert.doesNotMatch((await compactIdentity.textContent()) || '', /演示员工/);
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
    const detailPanel = document.querySelector('.cashier-shell__detail-panel');
    const actionRow = document.querySelector('[data-testid="table-detail-actions"]');
    const actionButtons = actionRow ? [...actionRow.querySelectorAll('button')] : [];
    const actionRect = actionRow instanceof HTMLElement ? actionRow.getBoundingClientRect() : null;
    const panelRect = detailPanel instanceof HTMLElement ? detailPanel.getBoundingClientRect() : null;
    const actionsContained = Boolean(actionRect && panelRect)
      && actionRect.left >= panelRect.left - 1
      && actionRect.right <= panelRect.right + 1
      && actionRect.top >= panelRect.top - 1
      && actionRect.bottom <= panelRect.bottom + 1
      && actionButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= panelRect.left - 1
          && rect.right <= panelRect.right + 1
          && rect.top >= panelRect.top - 1
          && rect.bottom <= panelRect.bottom + 1;
      });
    const actionButtonsOverlap = actionButtons.some((button, index) => {
      const rect = button.getBoundingClientRect();
      return actionButtons.slice(index + 1).some((candidate) => {
        const next = candidate.getBoundingClientRect();
        return rect.left < next.right - 1 && rect.right > next.left + 1
          && rect.top < next.bottom - 1 && rect.bottom > next.top + 1;
      });
    });
    const detailOverflow = detail instanceof HTMLElement
      ? Math.max(
          detail.scrollWidth - detail.clientWidth,
          ...[...detail.querySelectorAll(
            '.bill-order-row, .bill-order-row__meta b, .table-close-action, .table-print-action',
          )].map((element) => element instanceof HTMLElement
            ? element.scrollWidth - element.clientWidth
            : 0),
        )
      : 0;
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
      detailOverflowX: Math.max(0, detailOverflow),
      actionRowOverflowX: actionRow instanceof HTMLElement
        ? Math.max(0, actionRow.scrollWidth - actionRow.clientWidth)
        : 0,
      actionsContained,
      actionButtonsOverlap,
      actionGeometry: {
        panel: panelRect ? { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom } : null,
        row: actionRect ? { left: actionRect.left, right: actionRect.right, top: actionRect.top, bottom: actionRect.bottom } : null,
        buttons: actionButtons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      },
      standalonePrintCards: document.querySelectorAll('.print-job-actions').length,
      tableScrollOverflowY: (() => {
        const scroll = document.querySelector('[data-testid="table-bill-scroll"]');
        return scroll instanceof HTMLElement ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) : 0;
      })(),
      brand: rectOf('[data-testid="cashier-brand"]'),
      merchant: rectOf('[data-testid="cashier-merchant-panel"]'),
      employee: rectOf('[data-testid="employee-menu-trigger"]'),
      nav: rectOf('.cashier-navigation'),
      toolbar: rectOf('[data-testid="table-toolbar"]'),
      grid: rectOf('[data-testid="table-grid"]'),
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
  assert.equal(
    layout.actionsContained,
    true,
    `${width}x${height}: detail actions escape the right panel ${JSON.stringify(layout.actionGeometry)}`,
  );
  assert.equal(layout.actionButtonsOverlap, false, `${width}x${height}: detail action buttons overlap`);
  assert.ok(layout.actionRowOverflowX <= 1, `${width}x${height}: detail actions overflow horizontally`);
  assert.equal(layout.standalonePrintCards, 0, `${width}x${height}: standalone print card remains`);
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
    assertNear(layout.sidebar.width, 224, 4, `${width}x${height}: left rail width`);
    assertNear(layout.detail?.width ?? 0, 350, 4, `${width}x${height}: detail width`);
  }

  if (width === 1536 && height === 1024) {
    assertNear(layout.sidebar.width, 224, 4, '1536: left rail width');
    assertNear(layout.header.height, 108, 4, '1536: top bar height');
    assertNear(layout.route.width, 962, 4, '1536: central workspace width');
    assertNear(layout.detail?.width ?? 0, 350, 4, '1536: detail width');
    assertNear(layout.brand.x, 20, 4, '1536: brand x');
    assertNear(layout.brand.y, 20, 4, '1536: brand y');
    assertNear(layout.merchant.x, 20, 4, '1536: merchant x');
    assertNear(layout.merchant.y, 128, 4, '1536: merchant y');
    assertNear(layout.nav.x, 10, 4, '1536: navigation x');
    assertNear(layout.nav.y, 252, 4, '1536: navigation y');
    assertNear(layout.employee.x, 16, 4, '1536: employee x');
    assertNear(layout.employee.y, 902, 4, '1536: employee y');
    assertBetween(layout.search.width, 300, 320, '1536: search width');
    assertBetween(layout.firstCard?.width ?? 0, 218, 224, '1536: table card width');
    assertNear(layout.firstCard?.height ?? 0, 154, 4, '1536: table card height');
  }

  if (width === 1280 && height === 800) {
    assertNear(layout.sidebar.width, 186, 2, 'D10: left rail width');
    assertNear(layout.header.height, 84, 2, 'D10: top bar height');
    assertNear(layout.route.width, 802, 2, 'D10: central workspace width');
    assertNear(layout.detail?.width ?? 0, 292, 2, 'D10: detail width');
    assertNear(layout.detailOverflowX, 0, 1, 'D10: detail content overflow');
    assertNear(layout.brand.x, 14, 2, 'D10: brand x');
    assertNear(layout.brand.y, 14, 2, 'D10: brand y');
    assertNear(layout.brand.width, 158, 2, 'D10: brand width');
    assertNear(layout.brand.height, 54, 2, 'D10: brand height');
    assertNear(layout.merchant.x, 14, 2, 'D10: merchant x');
    assertNear(layout.merchant.y, 88, 2, 'D10: merchant y');
    assertNear(layout.merchant.width, 158, 2, 'D10: merchant width');
    assertNear(layout.merchant.height, 82, 2, 'D10: merchant height');
    assertNear(layout.nav.x, 8, 2, 'D10: navigation x');
    assertNear(layout.nav.y, 190, 2, 'D10: navigation y');
    assertNear(layout.nav.width, 170, 2, 'D10: navigation width');
    assertNear(layout.employee.x, 12, 2, 'D10: employee x');
    assertNear(layout.employee.y, 712, 2, 'D10: employee y');
    assertNear(layout.employee.width, 162, 2, 'D10: employee width');
    assertBetween(layout.employee.height, 68, 72, 'D10: employee height');
    assertNear(layout.toolbar.x, 196, 2, 'D10: toolbar x');
    assertNear(layout.toolbar.y, 96, 2, 'D10: toolbar y');
    assertNear(layout.toolbar.width, 782, 2, 'D10: toolbar width');
    assertNear(layout.toolbar.height, 52, 2, 'D10: toolbar height');
    assertNear(layout.search.width, 250, 2, 'D10: search width');
    assertNear(layout.search.height, 44, 2, 'D10: search height');
    assertBetween(layout.statuses.width, 248, 258, 'D10: status filter width');
    assertNear(layout.statuses.height, 44, 2, 'D10: status height');
    assert.ok(
      layout.statuses.x > layout.search.x + layout.search.width + 12,
      'D10: toolbar must retain a natural gap between search and status filters',
    );
    assertNear(
      layout.refresh.x - (layout.statuses.x + layout.statuses.width),
      10,
      2,
      'D10: gap between status filters and refresh',
    );
    assertNear(layout.refresh.width, 44, 2, 'D10: refresh width');
    assertNear(layout.refresh.height, 44, 2, 'D10: refresh height');
    assertNear(layout.refresh.x + layout.refresh.width, layout.toolbar.x + layout.toolbar.width, 2, 'D10: refresh right edge');
    assertNear(layout.grid.x, 196, 2, 'D10: table grid x');
    assertNear(layout.grid.width, 782, 2, 'D10: table grid width');
    assertNear(layout.firstCard?.x ?? 0, 196, 2, 'D10: first table card x');
    assertNear(layout.firstCard?.y ?? 0, 162, 2, 'D10: first table card y');
    assertBetween(layout.firstCard?.width ?? 0, 188, 190, 'D10: table card width');
    assertBetween(layout.firstCard?.height ?? 0, 130, 134, 'D10: table card height');
    assert.equal(layout.sidebarMerchantVisible, true, 'D10: merchant panel is missing');
    assert.equal(layout.sidebarEmployeeVisible, true, 'D10: employee card is missing');
  }
}

async function verifyPrintIsDisabled() {
  await selectFixtureTable();
  const printButton = page.getByTestId('print-primary');
  assert.equal(await printButton.isDisabled(), true, 'Printing must remain disabled until RC execution and printer gates are enabled');
  assert.match((await printButton.textContent()) || '', /打印桌账/);
  assert.match((await page.getByTestId('top-print-status').textContent()) || '', /打印功能未开通|未开通/);
  assert.equal(await page.locator('.print-job-actions').count(), 0, 'No standalone print card may remain');
  assert.equal(await page.locator('[data-testid*="print"][href]').count(), 0, 'No print navigation may be exposed');
}

async function verifyTableOrderingWorkspace() {
  await page.setViewportSize({ width: 1280, height: 800 });
  await selectFixtureTable();
  assert.match((await page.getByTestId('table-detail').textContent()) || '', /411[.,]?000/);
  const actions = page.getByTestId('table-detail-actions');
  assert.deepEqual(
    (await actions.locator('button').allTextContents()).map((label) => label.trim()),
    ['点菜', '打印桌账', '完成桌账'],
    'Open table actions must remain in one order/print/complete row',
  );

  await actions.getByTestId('table-order-items').click();
  const workspace = page.getByTestId('table-ordering-workspace');
  await workspace.waitFor();
  await workspace.getByText('演示牛肉粉', { exact: true }).waitFor();
  const geometry = await workspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      overflowX: element.scrollWidth - element.clientWidth,
      overflowY: element.scrollHeight - element.clientHeight,
    };
  });
  assertBetween(geometry.left, 170, 210, 'D10 ordering workspace left edge');
  assertBetween(geometry.top, 80, 90, 'D10 ordering workspace top edge');
  assertBetween(geometry.bottom - geometry.top, 700, 730, 'ordering workspace height should stay stable');
  assert.ok(geometry.overflowX <= 1, 'D10 ordering workspace overflows horizontally');
  assert.ok(geometry.overflowY <= 1, 'D10 ordering workspace overflows vertically');

  const confirm = workspace.getByTestId('confirm-table-order');
  assert.equal(await confirm.isDisabled(), true, 'Zero quantity must not be submitted');
  assert.equal(
    (await confirm.textContent())?.trim(),
    orderingLocaleCopy.zh.openTableOnly,
    'Existing open table default submit action should be open-only',
  );
  const orderingGridColumns = await workspace.locator('.table-ordering-product-grid').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.gridTemplateColumns.split(' ').filter(Boolean).length;
  });
  assert.equal(orderingGridColumns, 3, 'D10 ordering workspace should use 3 columns');

  const firstProduct = workspace.locator('.table-ordering-product').first();
  const firstProductDimensions = await firstProduct.evaluate((element) => {
    const content = element.querySelector('.table-ordering-product__content');
    const image = element.querySelector('.table-ordering-product__image');
    const name = content?.querySelector('strong');
    const price = content?.querySelector('b');
    const bottom = element.querySelector('.table-ordering-product__bottom');
    const quantity = content?.querySelector('.table-ordering-product__quantity');
    if (!content || !image || !name || !price || !quantity) {
      return {
        cardHeight: 0,
        imageWidth: 0,
        imageHeight: 0,
        nameGapToPriceRow: 0,
        priceBottomToCardBottom: 0,
        quantityBottomToCardBottom: 0,
        clamp: '',
      };
    }
    const cardRect = element.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    const bottomRect = bottom?.getBoundingClientRect();
    const quantityRect = quantity.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const nameStyle = getComputedStyle(name);
    return {
      cardHeight: cardRect.height,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      nameGapToPriceRow: bottomRect ? bottomRect.top - nameRect.bottom : 0,
      priceBottomToCardBottom: cardRect.bottom - (bottomRect?.bottom || price.getBoundingClientRect().bottom),
      quantityBottomToCardBottom: cardRect.bottom - quantityRect.bottom,
      clamp: nameStyle.getPropertyValue('-webkit-line-clamp'),
    };
  });
  assertBetween(firstProductDimensions.cardHeight, 126, 132, 'D10 product card height');
  assertBetween(firstProductDimensions.imageWidth, 90, 96, 'D10 product image width');
  assertBetween(firstProductDimensions.imageHeight, 90, 96, 'D10 product image height');
  assert.equal(firstProductDimensions.clamp, '2', 'D10 product name line clamp should be two lines');
  assert.ok(
    firstProductDimensions.nameGapToPriceRow >= 4
    && firstProductDimensions.nameGapToPriceRow <= 28,
    'D10 product name and price gap should be compact',
  );
  assert.ok(
    firstProductDimensions.priceBottomToCardBottom >= 8 && firstProductDimensions.priceBottomToCardBottom <= 24,
    'D10 price row should not leave excessive bottom whitespace',
  );
  assert.ok(
    firstProductDimensions.quantityBottomToCardBottom >= 8 && firstProductDimensions.quantityBottomToCardBottom <= 16,
    'D10 quantity control should stay within expected bottom spacing',
  );

  const zeroControls = await firstProduct.evaluate((element) => {
    const action = element.querySelector('.table-ordering-product__quantity')
      || element.querySelector('.table-ordering-product__actions');
    const quantity = element.querySelector('.table-ordering-quantity');
    if (!action || !quantity) {
      return {
        cardRight: 0,
        actionRight: 0,
        quantityButtonCount: 0,
        plusButtonWidth: 0,
        plusButtonHeight: 0,
        quantityHasOutput: false,
      };
    }
    const cardRect = element.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const plus = quantity.querySelector('button');
    const plusRect = plus?.getBoundingClientRect();
    return {
      cardRight: cardRect.right,
      actionRight: actionRect.right,
      quantityButtonCount: quantity.querySelectorAll('button').length,
      plusButtonWidth: plusRect?.width ?? 0,
      plusButtonHeight: plusRect?.height ?? 0,
      quantityHasOutput: Boolean(quantity.querySelector('output')),
    };
  });
  assert.equal(zeroControls.quantityButtonCount, 1, 'Zero quantity should render exactly one plus button');
  assert.equal(zeroControls.quantityHasOutput, false, 'Zero quantity should hide output text');
  assert.equal(zeroControls.actionRight <= zeroControls.cardRight, true, 'Zero quantity actions must stay inside card');
  assert.ok(zeroControls.plusButtonWidth >= 44, `Zero-state plus button width must be at least 44px, got ${zeroControls.plusButtonWidth}`);
  assert.ok(zeroControls.plusButtonHeight >= 44, `Zero-state plus button height must be at least 44px, got ${zeroControls.plusButtonHeight}`);

  await firstProduct.getByRole('button', { name: '增加数量' }).click();
  await firstProduct.getByRole('button', { name: '增加数量' }).click();
  await workspace.getByRole('button', { name: '饮品', exact: true }).click();
  const tea = workspace.locator('.table-ordering-product').nth(0);
  await tea.getByRole('button', { name: '增加数量' }).click();

  const firstProductLayout = await firstProduct.evaluate((element) => {
    const copy = element.querySelector('.table-ordering-product__content');
    const price = copy?.querySelector('b');
    const actions = element.querySelector('.table-ordering-product__quantity')
      || element.querySelector('.table-ordering-product__actions');
    if (!copy || !price || !actions) {
      return {
        priceBottom: 0,
        actionTop: 0,
        actionBottom: 0,
        priceTop: 0,
        cardRight: 0,
        actionRight: 0,
        quantityButtonCount: 0,
        actionInside: true,
        quantityRectLeft: 0,
      };
    }
    const priceRect = price.getBoundingClientRect();
    const actionRect = actions.getBoundingClientRect();
    const cardRect = element.getBoundingClientRect();
    const quantity = actions.querySelector('.table-ordering-quantity.has-quantity');
    const quantityRect = quantity?.getBoundingClientRect();
    const controlButtons = quantity ? [...quantity.querySelectorAll('button')] : [];
    const minusRect = controlButtons[0]?.getBoundingClientRect();
    const plusRect = controlButtons[1]?.getBoundingClientRect();
    return {
      sameRowCenterGap: Math.abs((priceRect.top + (priceRect.height / 2)) - (actionRect.top + (actionRect.height / 2))),
      priceBottom: priceRect.bottom,
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      priceTop: priceRect.top,
      cardRight: cardRect.right,
      actionRight: actionRect.right,
      quantityButtonCount: quantity?.querySelectorAll('button').length ?? 0,
      actionInside: actionRect.left >= cardRect.left - 1 && actionRect.right <= cardRect.right + 1,
      quantityRectLeft: quantityRect?.left ?? 0,
      quantityControlRight: quantityRect?.right ?? 0,
      actionWidth: actionRect.width,
      actionHeight: actionRect.height,
      minusWidth: minusRect?.width ?? 0,
      minusHeight: minusRect?.height ?? 0,
      plusWidth: plusRect?.width ?? 0,
      plusHeight: plusRect?.height ?? 0,
    };
  });
  assert.ok(firstProductLayout.sameRowCenterGap < 20, 'Price and actions should be aligned on the same row');
  assert.ok(firstProductLayout.actionTop <= firstProductLayout.priceBottom, 'Action controls should align with price row');
  assert.equal(firstProductLayout.quantityButtonCount, 2, 'Selected product must expose minus/plus pair');
  assert.equal(firstProductLayout.actionRight <= firstProductLayout.cardRight + 1, true, 'Actions must remain inside product card');
  assert.equal(firstProductLayout.actionInside, true, 'Actions must stay in card bounds');
  assert.ok(
    firstProductLayout.actionWidth >= 44,
    `Quantity control container width should be at least 44px, got ${firstProductLayout.actionWidth}`,
  );
  assert.ok(firstProductLayout.actionHeight >= 44, `Quantity control container height should be at least 44px, got ${firstProductLayout.actionHeight}`);
  assert.ok(firstProductLayout.minusWidth >= 44, `Minus button width should be at least 44px, got ${firstProductLayout.minusWidth}`);
  assert.ok(firstProductLayout.minusHeight >= 44, `Minus button height should be at least 44px, got ${firstProductLayout.minusHeight}`);
  assert.ok(firstProductLayout.plusWidth >= 44, `Plus button width should be at least 44px, got ${firstProductLayout.plusWidth}`);
  assert.ok(firstProductLayout.plusHeight >= 44, `Plus button height should be at least 44px, got ${firstProductLayout.plusHeight}`);

  assert.equal(
    (await confirm.textContent())?.trim(),
    orderingLocaleCopy.zh.openTableAndAddItems,
    'Open table with selected menu should use open+add label',
  );
  assert.equal(await confirm.isDisabled(), false, 'Selected menu item must enable confirmation');
  await confirm.click();
  await page.waitForURL('**/orders/new');
  await page.getByText(orderingLocaleCopy.zh.openAndAddSuccess, { exact: true }).waitFor();
  const createdCard = page.locator('.order-card').filter({ hasText: 'DEMO-ADD-001' });
  assert.equal(await createdCard.count(), 1, 'Fixture ordering must create one new pending order');
  assert.match((await page.locator('.order-detail-panel').textContent()) || '', /166[.,]?000/);

  const beefRow = page.locator('.order-item-row').filter({ hasText: '演示牛肉粉' });
  await beefRow.getByTestId('decrease-order-item').click();
  await page.getByText('减菜成功。', { exact: true }).waitFor();
  assert.match((await beefRow.textContent()) || '', /×\s*1/);
  assert.match((await page.locator('.order-detail-panel').textContent()) || '', /98[.,]?000/);

  await selectFixtureTable();
  const updatedBill = page.getByTestId('table-detail');
  assert.match((await updatedBill.textContent()) || '', /4\s*笔/);
  assert.match((await updatedBill.textContent()) || '', /509[.,]?000/);
}

async function verifyOrderingLayoutShots() {
  const cases = [
    [1280, 800, 'qty0'],
    [1280, 800, 'qty1'],
    [820, 1180, 'qty1'],
    [390, 844, 'qty0'],
    [390, 844, 'qty1'],
  ];
  for (const [width, height, state] of cases) {
    await page.setViewportSize({ width, height });
    await selectFixtureTable();
    const detail = page.getByTestId('table-detail');
    await detail.getByTestId('table-order-items').click();
    const workspace = page.getByTestId('table-ordering-workspace');
    await workspace.waitFor();
    const firstProduct = workspace.locator('.table-ordering-product').first();
    if (state === 'qty1') {
      await firstProduct.getByRole('button', { name: '增加数量' }).click();
    }
    await workspace.screenshot({
      path: `${orderingShotDir}/ordering-${width}x${height}-${state}.png`,
      animations: 'disabled',
    });
    await workspace.locator('.table-ordering-close').click();
    await workspace.waitFor({ state: 'hidden' });
  }
  process.stdout.write(`Ordering screenshots saved in ${orderingShotDir}\n`);
}

async function verifyOrderFlow() {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('a[href="/orders/history"]:visible').first().click();
  await page.waitForURL('**/orders/history');
  assert.equal(await page.locator('input[type="date"]').count(), 1);
  assert.equal(await page.locator('.compact-field select').count(), 1);

  await page.locator('a[href="/orders/new"]:visible').first().click();
  await page.waitForURL('**/orders/new');
  const createdCard = page.locator('.order-card').filter({ hasText: 'DEMO-ADD-001' });
  await createdCard.click();
  const actionLabels = await page.getByTestId('order-detail-actions').locator('button').evaluateAll((buttons) =>
    buttons
      .sort((left, right) => Number(getComputedStyle(left).order) - Number(getComputedStyle(right).order))
      .map((button) => button.textContent?.trim()),
  );
  assert.deepEqual(actionLabels, ['拒单', '打印', '接单']);
  assert.equal(await page.locator('.print-job-actions').count(), 0, 'New order detail must not show a print card');
  assert.equal(await page.getByTestId('decrease-order-item').count(), 2, 'Pending table order must expose decrease for each item');
  assert.ok(
    Math.min(...await page.getByTestId('decrease-order-item').evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    )) >= 44,
    'Decrease controls must keep a 44px minimum touch target',
  );
  assert.equal(await page.getByTestId('return-order-item').count(), 0, 'Pending table order must not expose return');
  await page.getByRole('button', { name: '拒单', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '接单', exact: true }).click();
  await page.getByText('订单状态已更新。').waitFor();
  const acceptedBeefRow = page.locator('.order-item-row').filter({ hasText: '演示牛肉粉' });
  const returnButton = acceptedBeefRow.getByTestId('return-order-item');
  await returnButton.waitFor();
  assert.ok(
    await returnButton.evaluate((button) => button.getBoundingClientRect().height) >= 44,
    'Return controls must keep a 44px minimum touch target',
  );
  assert.equal(await page.getByTestId('decrease-order-item').count(), 0, 'Accepted order must no longer expose decrease');
  await returnButton.click();
  const returnDialog = page.getByTestId('return-item-dialog');
  await returnDialog.waitFor();
  assert.equal(await returnDialog.locator('input, textarea').count(), 0, 'Simple return must not ask for a reason');
  await returnDialog.getByRole('button', { name: '确认退菜', exact: true }).click();
  await page.getByText('退菜成功。', { exact: true }).waitFor();
  assert.equal(await page.locator('.order-item-row').filter({ hasText: '演示牛肉粉' }).count(), 0);
  assert.match((await page.locator('.order-detail-panel').textContent()) || '', /30[.,]?000/);

  await selectFixtureTable();
  const updatedBill = page.getByTestId('table-detail');
  assert.match((await updatedBill.textContent()) || '', /4\s*笔/);
  assert.match((await updatedBill.textContent()) || '', /441[.,]?000/);
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

    if (locale === 'vi') {
      assert.deepEqual(
        (await page.locator('[data-testid="table-toolbar"] .status-filters button').allTextContents())
          .map((label) => label.trim()),
        ['Tất cả', 'Trống', 'Đang dùng', 'Đã tắt'],
        'Vietnamese table states must use the approved compact labels',
      );
      assert.equal(
        await page.getByText('Chờ đóng', { exact: true }).count(),
        0,
        'The backend has no independent ready-to-close state, so the fake filter must not remain',
      );
    }

    await selectFixtureTable();
    const tableDetail = page.getByTestId('table-detail');
    assert.equal(await tableDetail.getByTestId('table-summary-tab').isVisible(), true);
    assert.equal(await tableDetail.getByTestId('table-orders-tab').isVisible(), true);
    assert.equal(await tableDetail.getByTestId('table-detail-actions').locator('button').count(), 3);
    const tableOrderItems = tableDetail.getByTestId('table-order-items');
    await tableOrderItems.click();
    const workspace = page.getByTestId('table-ordering-workspace');
    await workspace.waitFor();
    const workspaceConfirm = workspace.getByTestId('confirm-table-order');
    assert.equal(await workspaceConfirm.isDisabled(), true, 'Locale ordering workspace should start disabled on zero selection');
    assert.equal(
      (await workspaceConfirm.textContent())?.trim(),
      orderingLocaleCopy[locale].openTableOnly,
      `${locale} zero-item submit label should require open-only`,
    );
    await workspace.getByRole('button', { name: orderingLocaleCopy[locale].increaseQuantity }).first().click();
    assert.equal(
      (await workspaceConfirm.textContent())?.trim(),
      orderingLocaleCopy[locale].openTableAndAddItems,
      `${locale} should switch to open-table-and-add-items when items selected`,
    );
    await assertOverlayWithinViewport(workspace, `${locale} D10 ordering workspace`);
    await workspace.locator('.table-ordering-close').click();
    await workspace.waitFor({ state: 'hidden' });

    if (locale === 'vi') {
      await tableDetail.getByTestId('table-order-items').click();
      const viWorkspace = page.getByTestId('table-ordering-workspace');
      await viWorkspace.waitFor();
      const firstProductCopy = viWorkspace.locator('.table-ordering-product__content strong').first();
      await viWorkspace.evaluate(() => {
      const firstCopy = document.querySelector('.table-ordering-product__content strong');
        if (firstCopy) {
          firstCopy.textContent = 'Thịt lợn quay giòn ngoài giòn thơm, thịt mềm bên trong, rau thơm và gia vị đặc trưng miền Nam';
        }
      });
      const viClamp = await firstProductCopy.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return style.getPropertyValue('-webkit-line-clamp') || style.lineClamp;
      });
      assert.equal(viClamp, '2', 'D10 Vietnamese dish name should be clamped to max two lines');
      await viWorkspace.locator('.table-ordering-close').click();
      await viWorkspace.waitFor({ state: 'hidden' });
    }

    await selectAvailableTableCard();
    const emptyAction = page.getByTestId('table-detail').getByTestId('table-order-items');
    assert.equal(
      (await emptyAction.textContent())?.trim(),
      orderingLocaleCopy[locale].openTable,
      `${locale} empty table must show open table entry`,
    );

    if (locale === 'vi' || locale === 'en') {
      await openTables();
      await tableDetail.getByTestId('table-order-items').click();
      const workspace = page.getByTestId('table-ordering-workspace');
      await workspace.waitFor();
      await assertOverlayWithinViewport(workspace, `${locale} D10 ordering workspace`);
      await workspace.locator('.table-ordering-close').click();

      await page.locator('a[href="/orders/active"]:visible').first().click();
      await page.waitForURL('**/orders/active');
      await page.locator('.order-card').filter({ hasText: 'DEMO-ADD-001' }).click();
      await page.getByTestId('return-order-item').first().click();
      const returnDialog = page.getByTestId('return-item-dialog');
      await returnDialog.waitFor();
      await assertOverlayWithinViewport(returnDialog, `${locale} D10 return dialog`);
      await returnDialog.locator('button.secondary-action').click();
      await selectFixtureTable();
    }

    for (const [width, height] of [
      [1280, 800],
      [1180, 800],
      [1024, 768],
      [820, 1180],
      [768, 1024],
      [430, 932],
      [390, 844],
      [375, 812],
      [360, 800],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      await page.getByTestId('table-detail').getByTestId('table-order-items').click();
      const narrowWorkspace = page.getByTestId('table-ordering-workspace');
      await narrowWorkspace.waitFor();
      const narrowColumns = await narrowWorkspace.locator('.table-ordering-product-grid').evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
        };
      });
      const narrowExpected = width >= 1180 ? 3 : width >= 768 ? 2 : 1;
      assert.equal(
        narrowColumns.columns,
        narrowExpected,
        `${locale} ${width}x${height}: ordering workspace should use responsive columns`,
      );
      await narrowWorkspace.locator('.table-ordering-close').click();
      await narrowWorkspace.waitFor({ state: 'hidden' });
      const overflow = await page.evaluate(() => {
        const horizontalOverflow = (element) => element instanceof HTMLElement
          ? element.scrollWidth - element.clientWidth
          : 0;
        const header = document.querySelector('[data-testid="cashier-topbar"]');
        const toolbar = document.querySelector('[data-testid="table-toolbar"]');
        const sidebar = document.querySelector('[data-testid="cashier-sidebar"]');
        const detail = document.querySelector('.cashier-shell__detail-panel');
        const actionRow = document.querySelector('[data-testid="table-detail-actions"]');
        const actionButtons = actionRow ? [...actionRow.querySelectorAll('button')] : [];
        const detailRect = detail instanceof HTMLElement ? detail.getBoundingClientRect() : null;
        const actionsContained = Boolean(detailRect) && actionButtons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= detailRect.left - 1 && rect.right <= detailRect.right + 1
            && rect.top >= detailRect.top - 1 && rect.bottom <= detailRect.bottom + 1;
        });
        const shortLabels = [...document.querySelectorAll('.top-status-item__label--short')]
          .filter((element) => getComputedStyle(element).display !== 'none');
        const statusContainer = document.querySelector('[data-testid="table-toolbar"] .status-filters');
        const statusButtons = [...document.querySelectorAll('[data-testid="table-toolbar"] .status-filters button')];
        const statusGeometry = statusButtons.map((button) => {
          const buttonRect = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          const textRect = range.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            button: {
              left: buttonRect.left,
              right: buttonRect.right,
              top: buttonRect.top,
              bottom: buttonRect.bottom,
            },
            text: {
              left: textRect.left,
              right: textRect.right,
              top: textRect.top,
              bottom: textRect.bottom,
            },
            whiteSpace: style.whiteSpace,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
          };
        });
        const adjacentButtonsOverlap = statusGeometry.some((item, index) => {
          const next = statusGeometry[index + 1];
          return next ? item.button.right > next.button.left + 1 : false;
        });
        const adjacentTextOverlaps = statusGeometry.some((item, index) => {
          const next = statusGeometry[index + 1];
          return next ? item.text.right > next.text.left + 1 : false;
        });
        const textOutsideButton = statusGeometry.some((item) => (
          item.text.left < item.button.left - 1
          || item.text.right > item.button.right + 1
          || item.text.top < item.button.top - 1
          || item.text.bottom > item.button.bottom + 1
        ));
        const invalidStatusStyle = statusGeometry.some((item) => (
          item.whiteSpace !== 'nowrap'
          || item.overflow !== 'visible'
          || item.textOverflow !== 'clip'
        ));
        return {
          documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          documentY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          headerX: horizontalOverflow(header),
          toolbarX: horizontalOverflow(toolbar),
          sidebarX: horizontalOverflow(sidebar),
          statusLabelX: Math.max(0, ...shortLabels.map(horizontalOverflow)),
          statusButtonX: Math.max(0, ...statusButtons.map(horizontalOverflow)),
          statusContainerX: Math.max(0, horizontalOverflow(statusContainer)),
          statusContainerOverflowX: statusContainer instanceof HTMLElement
            ? getComputedStyle(statusContainer).overflowX
            : '',
          adjacentButtonsOverlap,
          adjacentTextOverlaps,
          textOutsideButton,
          invalidStatusStyle,
          actionsContained,
          actionButtonX: Math.max(0, ...actionButtons.map(horizontalOverflow)),
        };
      });
      assert.ok(overflow.documentX <= 1, `${locale} ${width}x${height}: document overflows horizontally`);
      assert.ok(overflow.documentY <= 1, `${locale} ${width}x${height}: document overflows vertically`);
      assert.ok(overflow.headerX <= 1, `${locale} ${width}x${height}: top bar labels overflow`);
      assert.ok(overflow.toolbarX <= 1, `${locale} ${width}x${height}: toolbar labels overflow`);
      assert.ok(overflow.sidebarX <= 1, `${locale} ${width}x${height}: left identity content overflows`);
      assert.ok(overflow.statusLabelX <= 1, `${locale} ${width}x${height}: top short labels overflow`);
      assert.ok(overflow.statusButtonX <= 1, `${locale} ${width}x${height}: table state labels overflow`);
      assert.equal(overflow.adjacentButtonsOverlap, false, `${locale} ${width}x${height}: table state buttons overlap`);
      assert.equal(overflow.adjacentTextOverlaps, false, `${locale} ${width}x${height}: table state text overlaps`);
      assert.equal(overflow.textOutsideButton, false, `${locale} ${width}x${height}: table state text escapes its button`);
      assert.equal(overflow.invalidStatusStyle, false, `${locale} ${width}x${height}: table state nowrap/overflow rules changed`);
      assert.equal(overflow.actionsContained, true, `${locale} ${width}x${height}: action buttons escape the panel`);
      assert.ok(overflow.actionButtonX <= 1, `${locale} ${width}x${height}: action labels overflow`);
      if (width >= 900) {
        assert.ok(overflow.statusContainerX <= 1, `${locale} ${width}x${height}: table state container overflows`);
      } else {
        assert.equal(
          overflow.statusContainerOverflowX,
          'auto',
          `${locale} ${width}x${height}: compact table states must own their horizontal scrolling`,
        );
      }
    }
  }
}

async function verifyAndroidWebViewLandscape() {
  const webViewContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 YunQiaoMerchantTerminal/1.0',
    reducedMotion: 'reduce',
  });
  const webViewPage = await webViewContext.newPage();
  try {
    await webViewPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    await webViewPage.getByTestId('enter-demo').click();
    await webViewPage.waitForURL('**/tables');
    await webViewPage.getByTestId('table-card-demo-table-1').click();
    const detail = webViewPage.getByTestId('table-detail');
    await detail.waitFor();
    assert.equal(await detail.getByTestId('table-summary-tab').isVisible(), true);
    assert.equal(await detail.getByTestId('table-detail-actions').locator('button').count(), 3);
    assert.equal(await webViewPage.locator('.print-job-actions').count(), 0);
    await detail.getByTestId('table-order-items').click();
    const workspace = webViewPage.getByTestId('table-ordering-workspace');
    await workspace.waitFor();
    const webViewColumns = await workspace.locator('.table-ordering-product-grid').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });
    assert.equal(webViewColumns, 3, 'Android WebView ordering workspace should use 3 columns');
    const webViewFirstProduct = workspace.locator('.table-ordering-product').first();
  const webViewFirstProductDimensions = await webViewFirstProduct.evaluate((element) => {
    const content = element.querySelector('.table-ordering-product__content');
    const image = element.querySelector('.table-ordering-product__image');
    const name = content?.querySelector('strong');
    const quantity = content?.querySelector('.table-ordering-product__quantity');
    const price = content?.querySelector('b');
    const bottom = element.querySelector('.table-ordering-product__bottom');
    if (!content || !image || !name || !quantity || !price) {
      return {
        cardHeight: 0,
        imageWidth: 0,
        imageHeight: 0,
        clamp: '',
        nameGapToPriceRow: 0,
        quantityBottomToCardBottom: 0,
      };
    }
    const cardRect = element.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const nameStyle = getComputedStyle(name);
    const priceRect = price.getBoundingClientRect();
    const quantityRect = quantity.getBoundingClientRect();
    const bottomRect = bottom?.getBoundingClientRect();
    return {
      cardHeight: cardRect.height,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      clamp: nameStyle.getPropertyValue('-webkit-line-clamp'),
      nameGapToPriceRow: bottomRect ? bottomRect.top - name.getBoundingClientRect().bottom : 0,
      priceBottomToCardBottom: cardRect.bottom - priceRect.bottom,
      quantityBottomToCardBottom: cardRect.bottom - quantityRect.bottom,
    };
  });
    assertBetween(webViewFirstProductDimensions.cardHeight, 126, 132, 'Android product card height');
    assertBetween(webViewFirstProductDimensions.imageWidth, 90, 96, 'Android product image width');
    assertBetween(webViewFirstProductDimensions.imageHeight, 90, 96, 'Android product image height');
    assert.equal(webViewFirstProductDimensions.clamp, '2', 'Android product name line clamp should be two lines');
    assert.ok(
      webViewFirstProductDimensions.nameGapToPriceRow >= 4
      && webViewFirstProductDimensions.nameGapToPriceRow <= 24,
      'Android product name and price gap should be compact',
    );
    assert.ok(
      webViewFirstProductDimensions.priceBottomToCardBottom >= 8 && webViewFirstProductDimensions.priceBottomToCardBottom <= 24,
      'Android price row should not leave excessive bottom whitespace',
    );
    assert.ok(
      webViewFirstProductDimensions.quantityBottomToCardBottom >= 8 && webViewFirstProductDimensions.quantityBottomToCardBottom <= 16,
      'Android quantity control should stay within expected bottom spacing',
    );
  const webViewZeroControls = await webViewFirstProduct.evaluate((element) => {
    const action = element.querySelector('.table-ordering-product__quantity')
      || element.querySelector('.table-ordering-product__actions');
    const quantity = element.querySelector('.table-ordering-quantity');
      if (!action || !quantity) {
        return {
          cardRight: 0,
          actionRight: 0,
          quantityButtonCount: 0,
          quantityHasOutput: false,
        };
      }
    const cardRect = element.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const plus = quantity?.querySelector('button');
    const plusRect = plus?.getBoundingClientRect();
    return {
      cardRight: cardRect.right,
      actionRight: actionRect.right,
      quantityButtonCount: quantity.querySelectorAll('button').length,
      plusButtonWidth: plusRect?.width ?? 0,
      plusButtonHeight: plusRect?.height ?? 0,
      quantityHasOutput: Boolean(quantity.querySelector('output')),
    };
  });
    assert.equal(webViewZeroControls.quantityButtonCount, 1, 'Android zero quantity should show one add button');
  assert.equal(webViewZeroControls.quantityHasOutput, false, 'Android zero quantity should hide output');
  assert.equal(webViewZeroControls.actionRight <= webViewZeroControls.cardRight, true, 'Android controls must stay inside card');
  assert.ok(webViewZeroControls.plusButtonWidth >= 44, `Android zero-state plus button width must be at least 44px, got ${webViewZeroControls.plusButtonWidth}`);
  assert.ok(webViewZeroControls.plusButtonHeight >= 44, `Android zero-state plus button height must be at least 44px, got ${webViewZeroControls.plusButtonHeight}`);

    await webViewFirstProduct.getByRole('button', { name: '增加数量' }).click();
    await webViewFirstProduct.getByRole('button', { name: '增加数量' }).click();
    const webViewSelectedLayout = await webViewFirstProduct.evaluate((element) => {
      const action = element.querySelector('.table-ordering-product__quantity')
        || element.querySelector('.table-ordering-product__actions');
      if (!action) {
        return {
          cardRight: 0,
          actionRight: 0,
          quantityButtonCount: 0,
    actionInside: true,
          quantityRectLeft: 0,
        };
      }
      const cardRect = element.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      const quantity = action.querySelector('.table-ordering-quantity.has-quantity');
      const quantityRect = quantity?.getBoundingClientRect();
      const controlButtons = quantity ? [...quantity.querySelectorAll('button')] : [];
      const minusRect = controlButtons[0]?.getBoundingClientRect();
      const plusRect = controlButtons[1]?.getBoundingClientRect();
      return {
        cardRight: cardRect.right,
        actionRight: actionRect.right,
        quantityButtonCount: quantity?.querySelectorAll('button').length ?? 0,
        actionInside: actionRect.left >= cardRect.left - 1 && actionRect.right <= cardRect.right + 1,
        quantityRectLeft: quantityRect?.left ?? 0,
        minusWidth: minusRect?.width ?? 0,
        minusHeight: minusRect?.height ?? 0,
        plusWidth: plusRect?.width ?? 0,
        plusHeight: plusRect?.height ?? 0,
        actionWidth: actionRect.width,
        actionHeight: actionRect.height,
      };
    });
    assert.equal(webViewSelectedLayout.quantityButtonCount, 2, 'Android selected product should expose minus/plus pair');
    assert.equal(webViewSelectedLayout.actionRight <= webViewSelectedLayout.cardRight + 1, true, 'Android actions should stay inside card');
    assert.equal(webViewSelectedLayout.actionInside, true, 'Android actions should stay in card bounds');
    assert.ok(webViewSelectedLayout.actionHeight >= 44, `Android quantity control height should be at least 44px, got ${webViewSelectedLayout.actionHeight}`);
    assert.ok(webViewSelectedLayout.actionWidth >= 44, `Android quantity control width should be at least 44px, got ${webViewSelectedLayout.actionWidth}`);
    assert.ok(webViewSelectedLayout.minusWidth >= 44, `Android minus button width should be at least 44px, got ${webViewSelectedLayout.minusWidth}`);
    assert.ok(webViewSelectedLayout.minusHeight >= 44, `Android minus button height should be at least 44px, got ${webViewSelectedLayout.minusHeight}`);
    assert.ok(webViewSelectedLayout.plusWidth >= 44, `Android plus button width should be at least 44px, got ${webViewSelectedLayout.plusWidth}`);
    assert.ok(webViewSelectedLayout.plusHeight >= 44, `Android plus button height should be at least 44px, got ${webViewSelectedLayout.plusHeight}`);
    await assertOverlayWithinViewport(workspace, 'Android WebView ordering workspace');
    await workspace.locator('.table-ordering-close').click();

    await webViewPage.locator('a[href="/orders/new"]:visible').first().click();
    await webViewPage.waitForURL('**/orders/new');
    await webViewPage.locator('.order-card').filter({ hasText: 'DEMO-1001' }).click();
    await webViewPage.getByRole('button', { name: '接单', exact: true }).click();
    await webViewPage.getByText('订单状态已更新。').waitFor();
    await webViewPage.getByTestId('return-order-item').click();
    const returnDialog = webViewPage.getByTestId('return-item-dialog');
    await returnDialog.waitFor();
    await assertOverlayWithinViewport(returnDialog, 'Android WebView return dialog');
    await returnDialog.locator('button.secondary-action').click();
    const overflow = await webViewPage.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    assert.ok(overflow.x <= 1, 'Android WebView 1280x800 overflows horizontally');
    assert.ok(overflow.y <= 1, 'Android WebView 1280x800 overflows vertically');
  } finally {
    await webViewContext.close();
  }
}

async function verifyPwaManifestAndNavigation() {
  const response = await page.request.get(`${baseUrl}/manifest.webmanifest`);
  assert.equal(response.status(), 200, 'manifest.webmanifest should return 200');
  const manifest = await response.json();
  assert.equal(manifest.name, '云桥 Life 收银台');
  assert.equal(manifest.short_name, '云桥收银');
  assert.equal(manifest.start_url, '/tables');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');

  const contentType = response.headers()['content-type'] || '';
  assert.ok(contentType.includes('application/json') || contentType.includes('json'), 'manifest content-type should be JSON');

  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute('href'),
    '/manifest.webmanifest',
    'manifest link should point to /manifest.webmanifest',
  );
  const html = await page.content();
  assert.ok(html.includes('apple-mobile-web-app-capable'), 'iOS standalone meta is required');
  assert.ok(html.includes('apple-mobile-web-app-status-bar-style'), 'iOS status-bar meta is required');
  assert.ok(html.includes('viewport-fit=cover'), 'viewport-fit=cover is required');

  const rootNav = page.locator('.cashier-navigation a');
  const mobileNav = page.locator('.cashier-mobile-navigation a');
  const navs = await rootNav.count();
  const mobileNavs = await mobileNav.count();
  assert.equal(navs >= 4, true, 'desktop navigation should keep 4 links');
  assert.equal(mobileNavs >= 4, true, 'mobile navigation should keep 4 links');

  const links = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('.cashier-navigation a, .cashier-mobile-navigation a')];
    const routeSet = new Set(['/tables', '/orders/new', '/orders/active', '/orders/history']);
    return anchors.map((anchor) => {
      const element = anchor;
      return {
        href: element.getAttribute('href'),
        target: element.getAttribute('target') || '',
        rel: element.getAttribute('rel') || '',
        isRouteRelative: element.getAttribute('href')?.startsWith('/') ?? false,
        inScope: routeSet.has(element.getAttribute('href') || ''),
      };
    });
  });
  assert.equal(links.length >= 8, true, 'desktop/mobile navigation should provide 8+ anchors for the 4 canonical routes');
  links.forEach((link) => {
    assert.ok(link.inScope, `Navigation link ${link.href} must be inside scope`);
    assert.ok(!link.target, `Navigation link ${link.href} must not set target`);
  });

  assert.equal(context.pages().length, 1, 'Navigation should remain in one browser page');
  const before = await page.evaluate(() => ({
    pathname: location.pathname,
    navCount: performance.getEntriesByType('navigation').length,
    timeOrigin: performance.timeOrigin,
    hasSentinel: Boolean(window.__cashierUiSentinel?.value),
    bodyOverflow: getComputedStyle(document.body).overflow,
    historyLength: window.history.length,
    standalone: Boolean(
      navigator.standalone || window.matchMedia('(display-mode: standalone)').matches,
    ),
    documentNavigationTypes: performance.getEntriesByType('navigation').map((entry) => entry.entryType),
  }));
  assert.equal(before.hasSentinel, true, 'Sentinel should exist before navigation');
  assert.ok(
    ['auto', 'hidden'].includes(before.bodyOverflow),
    `Cashier shell should own body overflow (auto or hidden), got ${before.bodyOverflow}`,
  );
  assert.equal(before.standalone, false, 'Test should run in normal browser mode');

  for (const link of [
    '/orders/new',
    '/orders/active',
    '/orders/history',
    '/tables',
  ]) {
    const activeNav = page.locator(`a[href="${link}"]`).first();
    await activeNav.click();
    await page.waitForURL(`**${link}`);
    await page.waitForTimeout(120);
    assert.equal(context.pages().length, 1, `Navigate ${link}: still one page`);

    const next = await page.evaluate(() => ({
      path: location.pathname,
      timeOrigin: performance.timeOrigin,
      hasSentinel: Boolean(window.__cashierUiSentinel?.value),
      navigationLength: performance.getEntriesByType('navigation').length,
      historyLength: window.history.length,
    }));
    assert.equal(next.path, link, `Route should end at ${link}`);
    assert.equal(next.hasSentinel, true, 'Sentinel should remain present');
    assert.equal(next.timeOrigin, before.timeOrigin, 'SPA navigation must keep same timeOrigin');
    assert.equal(next.navigationLength, before.navCount, 'SPA navigation should not append page navigation entries');
    assert.ok(
      next.historyLength >= before.historyLength && next.historyLength <= before.historyLength + 4,
      'History should remain stable in shell navigation, no full document reloads',
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight <= 1), true);
  }
}

async function assertOverlayWithinViewport(locator, label) {
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflowX: element.scrollWidth - element.clientWidth,
      overflowY: element.scrollHeight - element.clientHeight,
    };
  });
  assert.ok(geometry.left >= -1, `${label}: escapes the left viewport edge`);
  assert.ok(geometry.top >= -1, `${label}: escapes the top viewport edge`);
  assert.ok(geometry.right <= geometry.viewportWidth + 1, `${label}: escapes the right viewport edge`);
  assert.ok(geometry.bottom <= geometry.viewportHeight + 1, `${label}: escapes the bottom viewport edge`);
  assert.ok(geometry.overflowX <= 1, `${label}: overflows horizontally`);
  assert.ok(geometry.overflowY <= 1, `${label}: overflows vertically`);
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
