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
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await assertVisibleText('智慧收银管理');
  await page.getByTestId('enter-demo').click();
  await page.waitForURL('**/tables');
  await page.locator('.table-card').first().waitFor();
  assert.equal(await page.locator('.quick-action--pending').isDisabled(), true);

  const viewports = [
    [1536, 1024],
    [1366, 768],
    [1280, 800],
    [1180, 820],
    [1024, 768],
    [820, 1180],
    [768, 1024],
  ];
  const expectedTableColumns = new Map([
    [1536, 6],
    [1366, 5],
    [1280, 5],
    [1180, 5],
    [1024, 4],
    [820, 3],
    [768, 3],
  ]);

  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.cashier-shell');
      const route = document.querySelector('.cashier-shell__route');
      const mobileNav = document.querySelector('.cashier-mobile-nav');
      const tableGrid = document.querySelector('.table-grid');
      if (!(shell instanceof HTMLElement) || !(route instanceof HTMLElement)) {
        throw new Error('Cashier shell was not rendered');
      }
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        routeOverflow: route.scrollWidth - route.clientWidth,
        mobileNavVisible: mobileNav instanceof HTMLElement && getComputedStyle(mobileNav).display !== 'none',
        tableColumns: tableGrid instanceof HTMLElement
          ? getComputedStyle(tableGrid).gridTemplateColumns.split(' ').length
          : 0,
      };
    });
    assert.ok(layout.documentOverflow <= 1, `${width}x${height}: document overflows horizontally`);
    assert.ok(layout.shellOverflow <= 1, `${width}x${height}: shell overflows horizontally`);
    assert.ok(layout.routeOverflow <= 1, `${width}x${height}: workspace overflows horizontally`);
    assert.equal(layout.mobileNavVisible, width < 900, `${width}x${height}: wrong navigation mode`);
    assert.equal(
      layout.tableColumns,
      expectedTableColumns.get(width),
      `${width}x${height}: wrong table column count`,
    );
  }

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

  await context.setOffline(true);
  await page.locator('.connectivity-banner').waitFor();
  await context.setOffline(false);

  for (const locale of ['vi', 'en']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.account-menu__trigger').click();
    await page.locator('.account-menu__popover select').selectOption(locale);
    await page.keyboard.press('Escape');
    await assertVisibleText('智慧收银管理');
    for (const [width, height] of [[1280, 800], [820, 1180]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${locale} ${width}x${height}: document overflows horizontally`);
    }
  }

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(`Verified ${viewports.length} viewports, zh/vi/en layouts, order confirmation, action flow, and network state.\n`);
} finally {
  await browser.close();
}

async function assertVisibleText(text) {
  assert.ok(await page.getByText(text, { exact: true }).first().isVisible(), `Missing visible text: ${text}`);
}
