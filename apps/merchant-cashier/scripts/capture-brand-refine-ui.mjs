import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../../docs/ui-review/merchant-cashier-v1-brand-refine',
);
const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const page = await context.newPage();

try {
  await enterFixtureDemo();
  await openTables();

  await capture('01-table-overview-1280x800.png', 1280, 800);
  await capture('02-table-overview-1366x768.png', 1366, 768);
  await capture('03-table-overview-1024x768.png', 1024, 768);
  await capture('04-table-overview-820x1180.png', 820, 1180);

  await capture('05-sidebar-expanded-1280x800.png', 1280, 800);
  await capture('06-sidebar-collapsed-1024x768.png', 1024, 768);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('.account-menu__trigger').click();
  await page.locator('.account-menu__popover').waitFor();
  await capture('07-account-menu-1280x800.png', 1280, 800);
  await page.keyboard.press('Escape');

  await page.locator('.account-menu__trigger').click();
  await page.locator('.account-menu__popover select').selectOption('vi');
  await page.keyboard.press('Escape');
  await page.locator('html[lang="vi"]').waitFor();
  await capture('08-vietnamese-1280x800.png', 1280, 800);
} finally {
  await browser.close();
}

async function enterFixtureDemo() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const demoEntry = page.getByTestId('enter-demo');
  if (!(await demoEntry.isVisible())) {
    throw new Error(
      'Fixture demo entry is unavailable. Start Vite with VITE_CASHIER_USE_FIXTURES=true.',
    );
  }
  await demoEntry.click();
  await page.waitForURL('**/tables');
  await page.locator('.table-card').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function openTables() {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (new URL(page.url()).pathname !== '/tables') {
    await page.locator('a[href="/tables"]:visible').first().click();
    await page.waitForURL('**/tables');
  }
  await page.getByTestId('table-toolbar').waitFor();
  await page.waitForTimeout(160);
}

async function capture(fileName, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
    animations: 'disabled',
  });
}
