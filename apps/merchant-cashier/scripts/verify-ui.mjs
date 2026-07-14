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
  await verifyBrandAndToolbar();
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
    `Verified the cashier brand and compact table toolbar at ${viewports.length} viewports, `
      + 'including the account menu, zh/vi/en overflow, order flow, and network state.\n',
  );
} finally {
  await browser.close();
}

async function enterFixtureDemo() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const demoEntry = page.getByTestId('enter-demo');
  assert.equal(await demoEntry.isVisible(), true, 'Fixture demo entry is unavailable');
  await demoEntry.click();
  await page.waitForURL('**/tables');
  await page.locator('.table-card').first().waitFor();
}

async function verifyBrandAndToolbar() {
  const workspace = page.getByTestId('table-overview-workspace');
  const toolbar = page.getByTestId('table-toolbar');
  const refresh = page.getByTestId('table-toolbar-refresh');
  await toolbar.waitFor();

  assert.equal(await workspace.getByText('全部区域', { exact: true }).count(), 0);
  assert.equal(await toolbar.locator('.area-tabs').count(), 0, 'The obsolete area selector must be removed');
  assert.equal(await toolbar.locator('.status-filters button').count(), 5, 'All five real table states must remain');
  assert.equal((await refresh.textContent())?.trim(), '', 'Refresh control must remain icon-only');
  assert.equal(await refresh.getAttribute('aria-label'), '刷新');
  assert.ok(await refresh.getAttribute('title'), 'Refresh control must expose a tooltip');

  const toolbarSizing = await page.evaluate(() => {
    const toolbarElement = document.querySelector('[data-testid="table-toolbar"]');
    const searchElement = toolbarElement?.querySelector('.cashier-search');
    const statusElement = toolbarElement?.querySelector('.status-filters');
    const refreshElement = document.querySelector('[data-testid="table-toolbar-refresh"]');
    const statusButtons = statusElement ? [...statusElement.querySelectorAll('button')] : [];
    if (!(toolbarElement instanceof HTMLElement)
      || !(searchElement instanceof HTMLElement)
      || !(statusElement instanceof HTMLElement)
      || !(refreshElement instanceof HTMLElement)
      || !statusButtons.length) {
      throw new Error('Brand-refined table toolbar controls were not rendered');
    }

    const toolbarRect = toolbarElement.getBoundingClientRect();
    const searchRect = searchElement.getBoundingClientRect();
    const statusRect = statusElement.getBoundingClientRect();
    const refreshRect = refreshElement.getBoundingClientRect();
    const buttonRects = statusButtons.map((button) => button.getBoundingClientRect());
    const buttonsWidth = buttonRects.reduce((total, rect) => total + rect.width, 0);

    return {
      toolbarHeight: toolbarRect.height,
      searchWidth: searchRect.width,
      searchHeight: searchRect.height,
      statusWidth: statusRect.width,
      statusHeight: statusRect.height,
      statusSlack: statusRect.width - buttonsWidth,
      statusFlexGrow: statusButtons.map((button) => getComputedStyle(button).flexGrow),
      statusMinimumWidth: Math.min(...buttonRects.map((rect) => rect.width)),
      refreshWidth: refreshRect.width,
      refreshHeight: refreshRect.height,
      ordered: searchRect.left < statusRect.left && statusRect.right <= refreshRect.left,
      sameRow: Math.abs(searchRect.top - statusRect.top) <= 1
        && Math.abs(statusRect.top - refreshRect.top) <= 1,
    };
  });

  assert.ok(
    toolbarSizing.toolbarHeight >= 51 && toolbarSizing.toolbarHeight <= 57,
    `1280x800: table toolbar must be 52–56px, got ${toolbarSizing.toolbarHeight}px`,
  );
  assert.ok(toolbarSizing.searchWidth >= 240, `Search must be at least 240px, got ${toolbarSizing.searchWidth}px`);
  assert.ok(
    toolbarSizing.searchHeight >= 39 && toolbarSizing.searchHeight <= 41,
    `Search must be 40px high, got ${toolbarSizing.searchHeight}px`,
  );
  assert.ok(
    toolbarSizing.statusHeight >= 39 && toolbarSizing.statusHeight <= 41,
    `Status control must be 40px high, got ${toolbarSizing.statusHeight}px`,
  );
  assert.ok(
    toolbarSizing.statusMinimumWidth >= 47,
    `Every status target must be at least 48px wide, got ${toolbarSizing.statusMinimumWidth}px`,
  );
  assert.ok(
    toolbarSizing.statusSlack <= 32,
    `Status control must fit its contents instead of stretching (${toolbarSizing.statusSlack}px slack)`,
  );
  assert.equal(
    toolbarSizing.statusFlexGrow.every((value) => Number(value) === 0),
    true,
    'Status buttons must not use flex-grow',
  );
  assert.ok(
    toolbarSizing.refreshWidth >= 39 && toolbarSizing.refreshWidth <= 41
      && toolbarSizing.refreshHeight >= 39 && toolbarSizing.refreshHeight <= 41,
    `Refresh control must be 40x40px, got ${toolbarSizing.refreshWidth}x${toolbarSizing.refreshHeight}`,
  );
  assert.equal(toolbarSizing.ordered, true, 'Toolbar order must be search → status → refresh');
  assert.equal(toolbarSizing.sameRow, true, '1280x800: toolbar controls must stay on one row');

  await verifyBrandAtViewport(1280, 800, { wordmarkVisible: true, placement: 'desktop' });
  await assertRemovedShellContent();
}

async function verifyAccountMenu() {
  await page.setViewportSize({ width: 1280, height: 800 });
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
    const search = toolbar?.querySelector('.cashier-search');
    const statuses = toolbar?.querySelector('.status-filters');
    const refresh = toolbar?.querySelector('[data-testid="table-toolbar-refresh"]');
    const headerTools = document.querySelector('.cashier-header__tools');
    if (!(shell instanceof HTMLElement)
      || !(header instanceof HTMLElement)
      || !(route instanceof HTMLElement)
      || !(toolbar instanceof HTMLElement)
      || !(search instanceof HTMLElement)
      || !(statuses instanceof HTMLElement)
      || !(refresh instanceof HTMLElement)) {
      throw new Error('Cashier shell was not rendered');
    }
    const shellRect = shell.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const routeRect = route.getBoundingClientRect();
    const detailRect = detail instanceof HTMLElement ? detail.getBoundingClientRect() : null;
    const sidebarRect = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect() : null;
    const searchRect = search.getBoundingClientRect();
    const statusesRect = statuses.getBoundingClientRect();
    const refreshRect = refresh.getBoundingClientRect();
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
      toolbarOneRow: Math.abs(searchRect.top - statusesRect.top) <= 1
        && Math.abs(statusesRect.top - refreshRect.top) <= 1,
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
    assert.equal(layout.toolbarOneRow, true, `${width}x${height}: desktop toolbar must stay on one row`);
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

  if (width === 1280) {
    await verifyBrandAtViewport(width, height, { wordmarkVisible: true, placement: 'desktop' });
  } else if (width === 1024) {
    await verifyBrandAtViewport(width, height, { wordmarkVisible: false, placement: 'desktop' });
  } else if (width === 820) {
    await verifyBrandAtViewport(width, height, { wordmarkVisible: true, placement: 'header' });
  } else if (width === 768) {
    await verifyBrandAtViewport(width, height, { wordmarkVisible: null, placement: 'header' });
  }
  await assertRemovedShellContent();
}

async function verifyBrandAtViewport(width, height, expectation) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(50);
  const brand = await page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const candidates = [
      ...document.querySelectorAll('[data-testid="cashier-brand"], .cashier-sidebar__brand, .cashier-header__brand, .cashier-brand'),
    ].filter((element, index, items) => items.indexOf(element) === index && visible(element));
    const visibleWordmarks = [...document.querySelectorAll('.cashier-brand__name')].filter(visible);
    const shell = document.querySelector('.cashier-shell');
    const brandLogos = shell
      ? [...shell.querySelectorAll('.cashier-brand__logo')].filter(visible)
      : [];
    const rect = candidates[0]?.getBoundingClientRect();
    const headerRect = document.querySelector('.cashier-header')?.getBoundingClientRect();
    const sidebarRect = document.querySelector('.cashier-sidebar')?.getBoundingClientRect();
    return {
      candidateCount: candidates.length,
      wordmarkCount: visibleWordmarks.length,
      logoCount: brandLogos.length,
      withinHeader: Boolean(rect && headerRect && rect.top >= headerRect.top - 1 && rect.bottom <= headerRect.bottom + 1),
      desktopLeft: Boolean(
        rect && headerRect && sidebarRect
        && rect.left >= sidebarRect.left - 1
        && rect.right <= sidebarRect.right + 1
        && Math.abs(rect.top - headerRect.top) <= 1,
      ),
    };
  });

  assert.equal(brand.candidateCount, 1, `${width}x${height}: exactly one cashier brand must be visible`);
  assert.equal(brand.logoCount, 1, `${width}x${height}: exactly one Yunqiao logo must be visible`);
  if (expectation.wordmarkVisible !== null) {
    assert.equal(
      brand.wordmarkCount,
      expectation.wordmarkVisible ? 1 : 0,
      `${width}x${height}: unexpected Yunqiao wordmark visibility`,
    );
  } else {
    assert.ok(brand.wordmarkCount <= 1, `${width}x${height}: the Yunqiao wordmark is duplicated`);
  }
  assert.equal(
    expectation.placement === 'header' ? brand.withinHeader : brand.desktopLeft,
    true,
    `${width}x${height}: brand must be placed in the ${expectation.placement}`,
  );
}

async function assertRemovedShellContent() {
  const shell = page.locator('.cashier-shell');
  for (const text of [
    '智慧收银管理',
    '高效经营 · 智能管理',
    '云桥收银台',
    'YUNQIAO CASHIER',
  ]) {
    assert.equal(await shell.getByText(text, { exact: true }).count(), 0, `Removed brand copy remains: ${text}`);
  }
  assert.equal(await shell.locator('.cashier-sidebar__account').count(), 0, 'Duplicate sidebar account card remains');
  assert.equal(await shell.locator('.account-menu__trigger').count(), 1, 'The top-right account entry must remain');
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('a[href="/tables"]:visible').first().click();
  await page.waitForURL('**/tables');
  await page.getByTestId('table-toolbar').waitFor();

  for (const locale of ['vi', 'en']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.account-menu__trigger').click();
    const popover = page.locator('.account-menu__popover');
    await popover.locator('select').selectOption(locale);
    assert.equal(await popover.locator('a').count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('html').evaluate((element, expectedLocale) => {
      if (element.getAttribute('lang') !== expectedLocale) {
        throw new Error(`Expected locale ${expectedLocale}`);
      }
    }, locale);
    await assertRemovedShellContent();

    for (const [width, height] of [[1280, 800], [820, 1180]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        toolbarHorizontal: (() => {
          const toolbar = document.querySelector('[data-testid="table-toolbar"]');
          return toolbar instanceof HTMLElement ? toolbar.scrollWidth - toolbar.clientWidth : 0;
        })(),
      }));
      assert.ok(overflow.horizontal <= 1, `${locale} ${width}x${height}: document overflows horizontally`);
      assert.ok(overflow.vertical <= 1, `${locale} ${width}x${height}: document overflows vertically`);
      assert.ok(overflow.toolbarHorizontal <= 1, `${locale} ${width}x${height}: toolbar overflows horizontally`);
    }
  }
}
