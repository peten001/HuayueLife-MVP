import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../../docs/ui-review/merchant-cashier-v1',
);
const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const demoEntry = page.getByTestId('enter-demo');
  if (!(await demoEntry.isVisible())) {
    throw new Error(
      'Fixture demo entry is unavailable. Start Vite with VITE_CASHIER_USE_FIXTURES=true.',
    );
  }
  await demoEntry.click();
  await page.waitForURL('**/tables');
  await page.locator('.table-card').first().click();

  await capture('01-cashier-1536x1024.png', 1536, 1024);
  await capture('02-cashier-1366x768.png', 1366, 768);
  await capture('03-cashier-1280x800.png', 1280, 800);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.shell-detail-close:visible').click();
  await capture('04-cashier-1024x768.png', 1024, 768);
  await capture('05-cashier-820x1180.png', 820, 1180);

  await openRoute('/orders/new');
  await capture('06-new-orders-1280x800.png', 1280, 800);

  await openRoute('/orders/active');
  await capture('07-active-orders-1280x800.png', 1280, 800);

  await openRoute('/orders/history');
  await capture('08-order-history-1280x800.png', 1280, 800);

  await openRoute('/orders/new');
  await page.locator('.order-card').first().click();
  await capture('09-order-detail-1280x800.png', 1280, 800);

  await openRoute('/tables');
  await page.locator('.table-card:not([disabled])').first().click();
  await capture('10-table-bill-1280x800.png', 1280, 800);
} finally {
  await browser.close();
}

async function openRoute(href) {
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForURL(`**${href}`);
  await page.waitForTimeout(220);
}

async function capture(fileName, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(220);
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
  });
}
