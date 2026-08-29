import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const outputDirectory = process.env.CANONICAL_UI_OUTPUT || '/tmp/huayue-canonical-state-v2-ui';
const browserErrors = [];
const results = [];
const viewports = [
  ['desktop-1920', 1920, 1080],
  ['desktop-1440', 1440, 900],
  ['desktop-1280-d10', 1280, 800],
  ['desktop-1024-d20', 1024, 768],
  ['mobile-430', 430, 932],
  ['mobile-390', 390, 844],
  ['mobile-375', 375, 812],
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CASHIER_BROWSER_CHANNEL || 'chrome', headless: true });

try {
  for (const [label, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`${label} console: ${message.text()}`);
    });
    page.on('pageerror', (error) => browserErrors.push(`${label} page: ${error.message}`));
    try {
      await enterDemo(page);
      await page.getByTestId('table-card-demo-table-1').click();
      await page.waitForURL(/\/tables\/demo-table-1/);
      await page.getByTestId('table-item-summary').waitFor();
      await page.waitForTimeout(260);

      const billText = (await page.getByTestId('table-detail').textContent()) || '';
      for (const forbidden of ['待提交', '本次待加', '正在处理', '结果尚未确认', 'PENDING_ACCEPTANCE', 'ACCEPTED']) {
        assert.equal(billText.includes(forbidden), false, `${label}: normal bill leaked ${forbidden}`);
      }
      assert.ok(await page.locator('.canonical-table-item-row').count() > 0, `${label}: canonical dish rows missing`);
      assert.ok(await page.locator('.committed-item-stepper output').count() > 0, `${label}: quantity controls missing`);
      await assertNoHorizontalOverflow(page, `${label}-bill`);
      await page.screenshot({ path: `${outputDirectory}/${label}-bill.png`, fullPage: false });

      await page.getByTestId('table-order-items').click();
      await page.getByTestId('table-ordering-workspace').waitFor();
      await page.waitForTimeout(160);
      const beforeCategorySwitch = await requiredBox(page.getByTestId('table-ordering-workspace'), `${label} menu`);
      const categoryButtons = page.getByTestId('table-ordering-category-strip').locator('button');
      assert.ok(await categoryButtons.count() >= 2, `${label}: category choices missing`);
      await categoryButtons.nth(1).click();
      await page.waitForTimeout(80);
      const afterCategorySwitch = await requiredBox(page.getByTestId('table-ordering-workspace'), `${label} menu after category`);
      assert.ok(Math.abs(beforeCategorySwitch.x - afterCategorySwitch.x) <= 1, `${label}: menu shifted horizontally after category change`);
      assert.ok(Math.abs(beforeCategorySwitch.width - afterCategorySwitch.width) <= 1, `${label}: menu width changed after category change`);

      await categoryButtons.first().click();
      const firstProduct = page.locator('.table-ordering-product').first();
      await firstProduct.waitFor();
      const initialQuantity = await quickAddQuantity(firstProduct);
      for (let index = 0; index < 10; index += 1) await firstProduct.click();
      await waitUntil(async () => (await quickAddQuantity(firstProduct)) >= initialQuantity + 10, `${label}: quick +10 did not converge`);
      await assertNoHorizontalOverflow(page, `${label}-menu`);
      await page.screenshot({ path: `${outputDirectory}/${label}-menu.png`, fullPage: false });

      await page.getByTestId('main-tab-tables').evaluate((element) => element.click());
      await page.getByTestId('table-detail').waitFor();
      await page.waitForTimeout(120);
      const afterStressText = (await page.getByTestId('table-detail').textContent()) || '';
      assert.equal(afterStressText.includes('待提交'), false, `${label}: quick +10 exposed pending copy`);
      assert.equal(afterStressText.includes('本次待加'), false, `${label}: quick +10 exposed staged-add copy`);

      if (label === 'desktop-1280-d10') await verifyEmptyRelease(page);
      results.push({ label, width, height, bill: 'PASS', menu: 'PASS', quickAdd10: 'PASS', overflow: 'NONE' });
    } finally {
      await context.close();
    }
  }

  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
  await writeFile(`${outputDirectory}/results.json`, `${JSON.stringify({ baseUrl, results, browserErrors }, null, 2)}\n`);
  process.stdout.write(`Canonical State V2 UI review PASS: ${results.length} viewports, artifacts ${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function enterDemo(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByTestId('enter-demo');
  assert.equal(await demo.isVisible(), true, 'start Vite with VITE_CASHIER_USE_FIXTURES=true');
  await demo.click();
  await page.waitForURL(/\/tables(?:\?.*)?$/);
  await page.getByTestId('table-grid').waitFor();
}

async function verifyEmptyRelease(page) {
  for (let attempts = 0; attempts < 80; attempts += 1) {
    if (await page.getByTestId('right-panel-empty-table').isVisible().catch(() => false)) break;
    const decrement = page.locator('[data-testid="decrease-canonical-line"]:not([disabled])').first();
    if (!(await decrement.count()) || await decrement.isDisabled()) break;
    await decrement.click();
    await page.waitForTimeout(20);
  }
  await page.getByTestId('right-panel-empty-table').waitFor();
  assert.match((await page.getByTestId('right-panel-header').textContent()) || '', /用餐中/);
  assert.match(page.url(), /\/tables\/demo-table-1/);
  assert.equal(await page.getByTestId('dinein-checkout').count(), 0, 'empty session must not show checkout');
  await page.getByTestId('dinein-release-empty').waitFor();
  await page.screenshot({ path: `${outputDirectory}/desktop-1280-d10-empty-open.png`, fullPage: false });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('dinein-release-empty').click();
  await page.waitForURL(/\/tables(?:\?.*)?$/);
  await page.getByTestId('table-card-demo-table-1').waitFor();
  assert.match((await page.getByTestId('table-card-demo-table-1').textContent()) || '', /空闲/);
}

async function quickAddQuantity(product) {
  const output = product.locator('.table-ordering-product__quick-add output');
  if (!(await output.count())) return 0;
  return Number(((await output.textContent()) || '0').replace(/\D/g, ''));
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  assert.ok(dimensions.documentScroll <= dimensions.documentClient + 1, `${label}: document horizontal overflow ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.bodyScroll <= dimensions.bodyClient + 1, `${label}: body horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function requiredBox(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label}: element has no layout box`);
  return box;
}

async function waitUntil(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(message);
}
