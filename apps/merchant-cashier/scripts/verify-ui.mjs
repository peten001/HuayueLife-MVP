import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const browserErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    const location = message.location().url;
    browserErrors.push(`console: ${message.text()}${location ? ` (${location})` : ''}`);
  }
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

try {
  await enterFixtureDemo();
  await verifyRefinedTableWorkspace();
  await verifyAccountMenu();

  const viewports = [
    [1536, 1024],
    [1366, 768],
    [1280, 800],
    [1180, 820],
    [1024, 768],
    [820, 1180],
    [768, 1024],
  ];

  for (const [width, height] of viewports) {
    await verifyViewport(width, height);
  }

  await verifyOrderFlow();
  await verifyNetworkState();
  await verifyLocales();

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(
    `Verified the refined cashier workspace at ${viewports.length} viewports, `
      + 'top statuses, account menu, zh/vi/en layouts, order flow, and network state.\n',
  );
} finally {
  await browser.close();
}

async function enterFixtureDemo() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await assertVisibleText('智慧收银管理');
  const demoEntry = page.getByTestId('enter-demo');
  assert.equal(await demoEntry.isVisible(), true, 'Fixture demo entry is unavailable');
  await demoEntry.click();
  await page.waitForURL('**/tables');
  await page.locator('.table-card').first().waitFor();
}

async function verifyRefinedTableWorkspace() {
  const workspace = page.getByTestId('table-overview-workspace');
  const toolbar = page.getByTestId('table-toolbar');
  const refresh = page.getByTestId('table-toolbar-refresh');
  await toolbar.waitFor();

  assert.equal(await workspace.getByText('桌台工作区', { exact: true }).count(), 0);
  assert.equal(await workspace.getByText('桌台占用状态由开放桌账实时推导。', { exact: true }).count(), 0);
  assert.equal(await workspace.getByText(/\d+桌空闲|\d+桌占用/).count(), 0);
  assert.equal((await refresh.textContent())?.trim(), '', 'Refresh control must remain icon-only');
  assert.equal(await refresh.getAttribute('aria-label'), '刷新');

  const compactSizing = await page.evaluate(() => {
    const toolbarElement = document.querySelector('[data-testid="table-toolbar"]');
    const refreshElement = document.querySelector('[data-testid="table-toolbar-refresh"]');
    if (!(toolbarElement instanceof HTMLElement) || !(refreshElement instanceof HTMLElement)) {
      throw new Error('Refined table toolbar controls were not rendered');
    }
    const toolbarRect = toolbarElement.getBoundingClientRect();
    const refreshRect = refreshElement.getBoundingClientRect();
    return {
      toolbarHeight: toolbarRect.height,
      refreshWidth: refreshRect.width,
      refreshHeight: refreshRect.height,
    };
  });
  assert.ok(
    compactSizing.toolbarHeight >= 51 && compactSizing.toolbarHeight <= 57,
    `1280x800: table toolbar must be 52–56px, got ${compactSizing.toolbarHeight}px`,
  );
  assert.ok(
    compactSizing.refreshWidth >= 39 && compactSizing.refreshWidth <= 41
      && compactSizing.refreshHeight >= 39 && compactSizing.refreshHeight <= 41,
    `Refresh control must be 40x40px, got ${compactSizing.refreshWidth}x${compactSizing.refreshHeight}`,
  );

  assert.equal(
    await page.locator('.cashier-bottom-bar, .cashier-quick-actions, .quick-action').count(),
    0,
    'The deleted desktop quick action bar must not remain in the DOM',
  );

  const statusItems = page.locator('.cashier-header-statuses .header-status-item');
  assert.equal(await statusItems.count(), 3, 'Header must expose network, sound, and print states');
  assert.equal(await page.locator('.cashier-header-statuses button[aria-pressed]').count(), 1);
  const printStatus = page.locator('.cashier-header-statuses .header-status-item--pending');
  assert.equal(await printStatus.count(), 1);
  assert.match((await printStatus.textContent()) ?? '', /待接入/);
  assert.equal(await printStatus.evaluate((element) => element.tagName), 'SPAN');

  const statusOrder = await page.evaluate(() => {
    const selectors = [
      '.order-reminder',
      '.cashier-header-statuses',
      '.icon-touch-button',
      '.cashier-clock',
      '.account-menu',
    ];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      return element instanceof HTMLElement ? element.getBoundingClientRect().left : Number.NaN;
    });
  });
  assert.equal(statusOrder.every(Number.isFinite), true, 'All header tool groups must be rendered');
  assert.equal(
    statusOrder.every((left, index) => index === 0 || left >= statusOrder[index - 1]),
    true,
    'Header tools must follow new-order → statuses → fullscreen → time → account order',
  );
}

async function verifyAccountMenu() {
  await page.locator('.account-menu__trigger').click();
  const popover = page.locator('.account-menu__popover');
  await popover.waitFor();
  assert.equal(await popover.locator('select').count(), 1, 'Language selector must remain');
  assert.equal(await popover.locator('button').count(), 1, 'Only logout may remain as an action');
  assert.equal(await popover.locator('a').count(), 0, 'Account menu must not contain navigation links');
  assert.equal(await popover.getByText('打开商家后台', { exact: true }).count(), 0);
  const itemCount = await popover.locator(':scope > label, :scope > button').count();
  assert.equal(itemCount, 2, 'Account menu must contain only language and logout rows');
  await page.keyboard.press('Escape');
}

async function verifyViewport(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.cashier-shell');
    const header = document.querySelector('.cashier-header');
    const route = document.querySelector('.cashier-shell__route');
    const detail = document.querySelector('.cashier-shell__detail');
    const sidebar = document.querySelector('.cashier-sidebar');
    const mobileNav = document.querySelector('.cashier-mobile-navigation');
    const tableGrid = document.querySelector('.table-grid');
    const toolbar = document.querySelector('[data-testid="table-toolbar"]');
    const headerTools = document.querySelector('.cashier-header__tools');
    if (!(shell instanceof HTMLElement)
      || !(header instanceof HTMLElement)
      || !(route instanceof HTMLElement)
      || !(toolbar instanceof HTMLElement)) {
      throw new Error('Cashier shell was not rendered');
    }
    const shellRect = shell.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const routeRect = route.getBoundingClientRect();
    const detailRect = detail instanceof HTMLElement ? detail.getBoundingClientRect() : null;
    const sidebarRect = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect() : null;
    const columnCount = tableGrid instanceof HTMLElement
      ? getComputedStyle(tableGrid).gridTemplateColumns.split(' ').length
      : 0;
    return {
      documentHorizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentVerticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      shellHorizontalOverflow: shell.scrollWidth - shell.clientWidth,
      shellVerticalOverflow: shell.scrollHeight - shell.clientHeight,
      routeHorizontalOverflow: route.scrollWidth - route.clientWidth,
      mobileNavVisible: mobileNav instanceof HTMLElement && getComputedStyle(mobileNav).display !== 'none',
      tableColumns: columnCount,
      toolbarHeight: toolbar.getBoundingClientRect().height,
      headerHeight: headerRect.height,
      sidebarWidth: sidebarRect?.width ?? 0,
      detailWidth: detailRect?.width ?? 0,
      desktopContentReachesBottom: detailRect
        ? Math.abs(routeRect.bottom - shellRect.bottom) <= 1
          && Math.abs(detailRect.bottom - shellRect.bottom) <= 1
        : false,
      headerToolsOverflow: headerTools instanceof HTMLElement
        ? headerTools.scrollWidth - headerTools.clientWidth
        : 0,
    };
  });

  assert.ok(layout.documentHorizontalOverflow <= 1, `${width}x${height}: document overflows horizontally`);
  assert.ok(layout.documentVerticalOverflow <= 1, `${width}x${height}: document overflows vertically`);
  assert.ok(layout.shellHorizontalOverflow <= 1, `${width}x${height}: shell overflows horizontally`);
  assert.ok(layout.shellVerticalOverflow <= 1, `${width}x${height}: shell overflows vertically`);
  assert.ok(layout.routeHorizontalOverflow <= 1, `${width}x${height}: workspace overflows horizontally`);
  assert.ok(layout.headerToolsOverflow <= 1, `${width}x${height}: header statuses overlap or overflow`);
  assert.equal(layout.mobileNavVisible, width < 900, `${width}x${height}: wrong navigation mode`);
  assert.ok(layout.tableColumns >= (width >= 1180 ? 5 : width >= 900 ? 4 : 3));

  if (width >= 900) {
    assert.ok(layout.toolbarHeight <= 57, `${width}x${height}: desktop toolbar exceeds 56px`);
  } else {
    assert.ok(layout.toolbarHeight <= 97, `${width}x${height}: tablet toolbar exceeds 96px`);
  }

  if (width >= 1180) {
    assert.equal(layout.desktopContentReachesBottom, true, `${width}x${height}: content does not reach shell bottom`);
  }

  if (width === 1280 && height === 800) {
    assert.ok(layout.headerHeight >= 67 && layout.headerHeight <= 73, `1280x800: header is ${layout.headerHeight}px`);
    assert.ok(layout.sidebarWidth >= 167 && layout.sidebarWidth <= 177, `1280x800: sidebar is ${layout.sidebarWidth}px`);
    assert.ok(layout.detailWidth >= 299 && layout.detailWidth <= 313, `1280x800: detail is ${layout.detailWidth}px`);
  }
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

async function verifyNetworkState() {
  await context.setOffline(true);
  const networkStatus = page.locator('.cashier-header-statuses .header-status-item').first();
  await networkStatus.waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('.cashier-header-statuses .header-status-item');
    return element?.classList.contains('header-status-item--danger');
  });
  assert.match((await networkStatus.textContent()) ?? '', /网络异常/);
  await context.setOffline(false);
  await page.waitForFunction(() => {
    const element = document.querySelector('.cashier-header-statuses .header-status-item');
    return element?.classList.contains('header-status-item--ok')
      || element?.classList.contains('header-status-item--warning');
  });
}

async function verifyLocales() {
  for (const locale of ['vi', 'en']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.account-menu__trigger').click();
    const popover = page.locator('.account-menu__popover');
    await popover.locator('select').selectOption(locale);
    assert.equal(await popover.locator('a').count(), 0);
    await page.keyboard.press('Escape');
    await assertVisibleText('智慧收银管理');

    for (const [width, height] of [[1280, 800], [820, 1180]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      assert.ok(overflow.horizontal <= 1, `${locale} ${width}x${height}: document overflows horizontally`);
      assert.ok(overflow.vertical <= 1, `${locale} ${width}x${height}: document overflows vertically`);
    }
  }
}

async function assertVisibleText(text) {
  assert.ok(await page.getByText(text, { exact: true }).first().isVisible(), `Missing visible text: ${text}`);
}
