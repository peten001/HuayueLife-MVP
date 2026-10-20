import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const output = process.env.CURRENT_SHELL_OUTPUT || '/tmp/yunqiao-current-shell-cleanup-20261020/shells';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { source: 'Loopback isolated fixtures only', cashier: [], merchant: [], errors: [] };
await mkdir(output, { recursive: true });
const errors = page => page.on('pageerror', error => report.errors.push(error.message));
try {
  for (const width of [320, 390, 768, 899, 900, 1280, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); errors(page);
    await page.goto('http://127.0.0.1:5176/login');
    await page.getByTestId('enter-demo').click();
    await expect(page.getByTestId('table-grid')).toBeVisible();
    for (const path of ['/tables', '/reservations', '/pickup', '/delivery', '/orders/history', '/orders/new', '/orders/active']) {
      await page.evaluate(async target => {
        const { default: router } = await import('/src/router/index.ts');
        await router.push(target);
      }, path);
      await expect(page.locator('.cashier-shell')).toBeVisible();
      assert(!['/orders/new', '/orders/active'].includes(new URL(page.url()).pathname));
      await expect(page.locator('.cashier-mobile-navigation')).toHaveCount(0);
      await expect(page.locator('.mobile-v2-preview-frame')).toHaveCount(width < 900 ? 1 : 0);
      await expect(page.locator('.cashier-header')).toHaveCount(width < 900 ? 0 : 1);
      report.cashier.push({ width, requested: path, destination: new URL(page.url()).pathname });
    }
    // A future route inherits the phone shell without a per-page opt-in.
    await page.evaluate(async () => {
      const { default: router } = await import('/src/router/index.ts');
      router.addRoute('cashier-workspace', { path: 'shell-inheritance-test', name: 'shell-inheritance-test', component: { render: () => null } });
      await router.push('/shell-inheritance-test');
    });
    await expect(page.locator('.mobile-v2-preview-frame')).toHaveCount(width < 900 ? 1 : 0);
    await expect(page.locator('.cashier-header')).toHaveCount(width < 900 ? 0 : 1);
    report.cashier.push({ width, requested: 'new unregistered workspace', destination: new URL(page.url()).pathname });
    await context.close();
  }
  for (const width of [390, 1280]) {
    for (const legacyPrintingEnabled of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage(); errors(page);
      const oldPrinterRequests = [];
      page.on('request', request => { if (/\/api\/v1\/merchant\/printers(?:[/?]|$)/.test(request.url())) oldPrinterRequests.push(request.url()); });
      await page.route('**/merchant/printing/feature-state', route => route.fulfill({ json: { code: 'OK', data: { taskCenterEnabled: true, automaticCreationEnabled: false, executionEnabled: false, lanPrintingEnabled: false, legacyPrintingEnabled, merchantPrintingEnabled: true, executionState: 'CONNECTOR_PENDING' } } }));
      for (const [path, target] of [
        ['/merchant/printers', '/printing-center/printers'],
        ['/merchant/business-settings', '/merchant/profile'],
        ['/merchant/profile/change-password', '/merchant/profile'],
        ['/reports', '/merchant/profile'],
        ['/menu/categories', '/menu/products'],
        ['/settings/android-terminal', '/printing-center/android-terminal'],
        ['/forbidden', '/forbidden'],
      ]) {
        await page.goto('http://127.0.0.1:4198' + path);
        await expect(page.locator('.merchant-workbench .m-main')).toBeVisible();
        assert.equal(new URL(page.url()).pathname, target);
        await expect(page.locator('.merchant-sidebar, .mobile-header, .merchant-mobile-nav')).toHaveCount(0);
        await expect(page.locator(width < 769 ? '.m-bottom-nav' : '.m-desktop-nav')).toBeVisible();
        report.merchant.push({ width, legacyPrintingEnabled, requested: path, destination: target });
      }
      assert.equal(oldPrinterRequests.length, 0, 'old printing pages must never load even when the server legacy flag is enabled');
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-local-role': 'STAFF' } });
    const page = await context.newPage(); errors(page);
    await page.goto('http://127.0.0.1:4198/staff');
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.locator('.merchant-workbench .mx-access')).toBeVisible();
    await expect(page.locator(width < 769 ? '.m-bottom-nav' : '.m-desktop-nav')).toBeVisible();
    report.merchant.push({ width, role: 'STAFF', permissionDeniedInCurrentShell: true });
    await context.close();
  }
  assert.equal(report.errors.length, 0);
} finally {
  await browser.close();
  await writeFile(output + '/REPORT.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: true, cashier: report.cashier.length, merchant: report.merchant.length, errors: report.errors }));
