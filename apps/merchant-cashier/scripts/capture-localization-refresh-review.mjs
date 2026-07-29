import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const observedMs = Number(process.env.POLL_OBSERVE_MS || 70_000);
const outputDirectory = resolve(process.cwd(), '../../docs/ui-review/cashier-localization-refresh-merchant-image');
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: process.env.CASHIER_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
const browserErrors = [];
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
page.on('pageerror', (error) => browserErrors.push(error.message));

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('enter-demo').click();
  await page.waitForURL((url) => url.pathname === '/tables');
  await page.evaluate(() => {
    window.history.pushState({}, '', '/tables/demo-table-1');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForURL((url) => url.pathname === '/tables/demo-table-1');
  await page.getByTestId('table-item-summary').waitFor();
  await page.locator('.cashier-merchant-panel__logo img').waitFor();

  await selectLocale(page, 'zh');
  await assertItemName(page, '演示菜品（非真实）');
  await page.screenshot({ path: resolve(outputDirectory, '01-zh-order-item.png'), fullPage: true });
  await page.getByTestId('cashier-merchant-panel').screenshot({ path: resolve(outputDirectory, '04-merchant-store-image.png') });
  await page.screenshot({ path: resolve(outputDirectory, '05-1280x800-full-page.png'), fullPage: true });

  await selectLocale(page, 'vi');
  await assertItemName(page, 'Món ăn demo (dữ liệu giả)');
  await page.screenshot({ path: resolve(outputDirectory, '02-vi-order-item.png'), fullPage: true });

  await selectLocale(page, 'en');
  await assertItemName(page, 'Demo dish (not real data)');
  await page.screenshot({ path: resolve(outputDirectory, '03-en-order-item.png'), fullPage: true });

  await selectLocale(page, 'zh');
  const scroll = page.getByTestId('table-bill-scroll');
  await scroll.evaluate((element) => { element.scrollTop = Math.min(40, element.scrollHeight - element.clientHeight); });
  const initialScrollTop = await scroll.evaluate((element) => element.scrollTop);
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="table-route-detail"]');
    window.__cashierPollEvidence = { loadingAppearances: 0, detailDisappearances: 0, mutations: 0 };
    const inspect = () => {
      if (!root) return;
      if (root.querySelector('.loading-skeleton')) window.__cashierPollEvidence.loadingAppearances += 1;
      if (!root.querySelector('[data-testid="table-detail"]')) window.__cashierPollEvidence.detailDisappearances += 1;
    };
    new MutationObserver(() => {
      window.__cashierPollEvidence.mutations += 1;
      inspect();
    }).observe(root, { childList: true, subtree: true });
    inspect();
  });

  await page.waitForTimeout(observedMs);
  const evidence = await page.evaluate(() => window.__cashierPollEvidence);
  const finalScrollTop = await scroll.evaluate((element) => element.scrollTop);
  assert.equal(evidence.loadingAppearances, 0, 'background polling must not show the detail skeleton');
  assert.equal(evidence.detailDisappearances, 0, 'background polling must keep detail mounted');
  assert.equal(new URL(page.url()).pathname, '/tables/demo-table-1', 'selected table must remain stable');
  assert.equal(finalScrollTop, initialScrollTop, 'detail scroll position must remain stable');
  assert.equal(await page.getByTestId('table-detail').isVisible(), true, 'selected table detail remains visible');
  if (observedMs >= 70_000) {
    await page.screenshot({ path: resolve(outputDirectory, '06-after-70s-polling.png'), fullPage: true });
  }

  const report = {
    observedMs,
    expectedPollingCycles: Math.floor(observedMs / 10_000),
    loadingAppearances: evidence.loadingAppearances,
    detailDisappearances: evidence.detailDisappearances,
    mutationCallbacks: evidence.mutations,
    initialScrollTop,
    finalScrollTop,
    selectedPath: new URL(page.url()).pathname,
    browserErrors,
  };
  if (observedMs >= 70_000) {
    await writeFile(resolve(outputDirectory, 'polling-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve(outputDirectory, '07-pc-1920x1080-full-page.png'), fullPage: true });
  assert.deepEqual(browserErrors, []);
  process.stdout.write(`Captured localization, merchant image, and ${observedMs}-ms polling review in ${outputDirectory}\n`);
} finally {
  await context.close();
  await browser.close();
}

async function selectLocale(targetPage, locale) {
  const trigger = targetPage.getByTestId('employee-menu-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await targetPage.getByTestId('employee-menu-popover').locator('select').selectOption(locale);
  await targetPage.waitForFunction((expected) => document.documentElement.lang === expected, locale === 'zh' ? 'zh-CN' : locale);
  await trigger.click();
}

async function assertItemName(targetPage, expected) {
  const summary = targetPage.getByTestId('table-item-summary');
  await summary.getByText(expected, { exact: true }).first().waitFor();
  assert.match((await summary.textContent()) || '', new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
