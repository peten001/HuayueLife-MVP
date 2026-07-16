import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = process.env.CASHIER_SCREENSHOT_DIR
  ? resolve(process.env.CASHIER_SCREENSHOT_DIR)
  : resolve(scriptDirectory, '../../../docs/ui-review/merchant-cashier-final-layout');
const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const browserErrors = [];

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: 'light',
});
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

try {
  await enterFixtureDemo();
  await selectFixtureTable();

  await capture('01-table-summary-1920x1080.png', 1920, 1080);
  await capture('02-table-summary-1440x900.png', 1440, 900);
  await capture('03-table-summary-1280x800.png', 1280, 800);
  await page.getByTestId('table-orders-tab').click();
  await capture('04-table-orders-1280x800.png', 1280, 800);
  await page.getByTestId('table-summary-tab').click();

  await setLocale('zh');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('employee-menu-trigger').click();
  await page.getByTestId('employee-menu-popover').waitFor();
  await clearInteractionFocus();
  await capture('05-sidebar-role-menu-1280x800.png', 1280, 800);
  await page.keyboard.press('Escape');
  await clearInteractionFocus();

  await page.locator('a[href="/orders/new"]:visible').first().click();
  await page.waitForURL('**/orders/new');
  await page.locator('.order-card').first().click();
  await page.getByTestId('order-detail-actions').waitFor();
  await capture('06-new-order-actions-1280x800.png', 1280, 800);

  await setLocale('vi');
  await capture('07-new-order-vietnamese-1280x800.png', 1280, 800);

  await setLocale('en');
  await capture('08-new-order-english-1280x800.png', 1280, 800);

  await setLocale('zh');
  await page.getByTestId('top-print-status').waitFor();
  await capture('09-new-order-print-gated-1280x800.png', 1280, 800);

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(`Captured final cashier review images in ${outputDirectory}\n`);
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

async function selectFixtureTable() {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('table-card-demo-table-1').click();
  await page.getByTestId('table-detail').waitFor();
  await page.waitForTimeout(120);
}

async function setLocale(locale) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const currentLocale = await page.locator('html').getAttribute('lang');
  if (currentLocale === locale) return;
  await page.getByTestId('employee-menu-trigger').click();
  const popover = page.getByTestId('employee-menu-popover');
  await popover.locator('select').selectOption(locale);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (expectedLocale) => document.documentElement.lang === expectedLocale,
    locale === 'zh' ? 'zh-CN' : locale,
  );
  await clearInteractionFocus();
}

async function clearInteractionFocus() {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(640, 760);
}

async function capture(fileName, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
    animations: 'disabled',
  });
}
