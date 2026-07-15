import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../../docs/ui-review/merchant-cashier-v1-width-refine',
);
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

  await setLocale('zh');
  await capture('01-zh-1280x800.png', 1280, 800);

  await setLocale('vi');
  await capture('02-vi-1280x800.png', 1280, 800);

  await setLocale('en');
  await capture('03-en-1280x800.png', 1280, 800);

  await setLocale('zh');
  await capture('04-zh-1536x1024.png', 1536, 1024);

  await setLocale('vi');
  await closeResponsiveDetail(1024, 768);
  await capture('05-vi-1024x768.png', 1024, 768);
  await closeResponsiveDetail(820, 1180);
  await capture('06-vi-820x1180.png', 820, 1180);

  await setLocale('zh');
  await page.getByTestId('employee-menu-trigger').click();
  await page.getByTestId('employee-menu-popover').waitFor();
  await capture('07-sidebar-1280x800.png', 1280, 800);
  await page.keyboard.press('Escape');

  await selectFixtureTable();
  await capture('08-right-detail-1280x800.png', 1280, 800);

  await setLocale('vi');
  await capture('09-toolbar-vi-1280x800.png', 1280, 800);

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  process.stdout.write(`Captured cashier width-refinement review images in ${outputDirectory}\n`);
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

async function closeResponsiveDetail(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(100);
  const detail = page.locator('.cashier-shell__detail--open');
  if (await detail.count()) {
    await detail.locator('.shell-detail-close').click();
    await page.locator('.cashier-shell__detail--open').waitFor({ state: 'detached' });
  }
}

async function setLocale(locale) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const expectedLocale = locale === 'zh' ? 'zh-CN' : locale;
  if (await page.locator('html').getAttribute('lang') === expectedLocale) return;
  await page.getByTestId('employee-menu-trigger').click();
  const popover = page.getByTestId('employee-menu-popover');
  await popover.locator('select').selectOption(locale);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (documentLocale) => document.documentElement.lang === documentLocale,
    expectedLocale,
  );
  await clearInteractionFocus();
}

async function clearInteractionFocus() {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(1, 1);
}

async function capture(fileName, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  await page.evaluate(() => document.fonts.ready);
  await clearInteractionFocus();
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
    animations: 'disabled',
  });
}
