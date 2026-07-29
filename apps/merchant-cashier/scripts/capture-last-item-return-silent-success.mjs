import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../../docs/ui-review/cashier-last-item-return-silent-success',
);
const configuredBaseUrl = new URL(
  process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176',
);
const allowedHosts = new Set(['127.0.0.1', 'localhost']);
const browserChannel = process.env.CASHIER_BROWSER_CHANNEL || 'chrome';
const browserErrors = [];
const networkViolations = [];
const captureNames = new Set();
let screenshotWrites = 0;

assert.equal(configuredBaseUrl.protocol, 'http:', 'The review must use a local HTTP Fixture server');
assert.equal(
  allowedHosts.has(configuredBaseUrl.hostname),
  true,
  'CASHIER_BASE_URL must use localhost or 127.0.0.1',
);
assert.equal(configuredBaseUrl.username, '', 'CASHIER_BASE_URL must not contain a username');
assert.equal(configuredBaseUrl.password, '', 'CASHIER_BASE_URL must not contain a password');
assert.equal(configuredBaseUrl.search, '', 'CASHIER_BASE_URL must not contain query parameters');
assert.equal(configuredBaseUrl.hash, '', 'CASHIER_BASE_URL must not contain a fragment');

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel === 'bundled' ? undefined : browserChannel,
  headless: true,
});

try {
  await captureLastTableItemSequence();
  await captureMultipleQuantityReturn();
  await captureOtherOrdersRemain();
  await captureStaleQuantityError();
  await captureSilentAddItemsFullPage();
  await captureVietnameseDangerConfirmation();

  assert.equal(captureNames.size, 8, 'The review must define exactly eight screenshot scenes');
  assert.equal(screenshotWrites, 8, 'The review must write exactly eight screenshots');
  assert.deepEqual(
    networkViolations,
    [],
    `The Fixture review attempted non-local network access:\n${networkViolations.join('\n')}`,
  );
  assert.deepEqual(
    browserErrors,
    [],
    `Browser console/page errors:\n${browserErrors.join('\n')}`,
  );
  process.stdout.write(
    `Captured and verified eight last-item-return and silent-success screenshots in ${outputDirectory}\n`,
  );
} finally {
  await browser.close();
}

async function captureLastTableItemSequence() {
  await withFixturePage('last-table-item', { width: 1920, height: 1080 }, async (page) => {
    await openDemoTable(page);
    await prepareSingleRemainingItem(page);

    await assertTableItemState(page, { rows: 1, quantity: 1, status: 'IN_USE' });
    await capture(page, '01-last-item-before-1920x1080.png');

    const dialog = await openFirstReturnDialog(page);
    const danger = dialog.getByTestId('last-item-return-danger');
    await danger.waitFor();
    assert.match(
      (await danger.textContent()) || '',
      /整桌没有其他有效菜品.*自动关闭.*释放桌台/,
      'The final table item must explain automatic table-bill closure and release',
    );
    await capture(page, '02-last-item-danger-confirm-1920x1080.png');

    await confirmReturn(page, dialog);
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="table-card-demo-table-1"]');
      const detail = document.querySelector('[data-testid="table-detail"]');
      return card?.getAttribute('data-status') === 'AVAILABLE'
        && Boolean(detail?.textContent?.includes('当前桌台空闲'))
        && Boolean(detail?.querySelector('[data-testid="table-order-items"]'));
    });
    assert.equal(new URL(page.url()).pathname, '/tables/demo-table-1');
    assert.equal(await page.locator('.table-item-summary-row').count(), 0);
    assert.match(
      (await page.getByTestId('table-detail').textContent()) || '',
      /空闲[\s\S]*开台点菜/,
    );
    await assertSilentSuccess(page, 'returning the final table item');
    await capture(page, '03-table-idle-after-return-1920x1080.png');
  });
}

async function captureMultipleQuantityReturn() {
  await withFixturePage('multiple-quantity', { width: 1280, height: 800 }, async (page) => {
    await openDemoTable(page);
    await returnOneFromFirstRow(page);
    await assertTableItemState(page, { rows: 3, quantity: 2, status: 'IN_USE' });
    await capture(page, '04-multiple-quantity-return-one-1280x800.png');
  });
}

async function captureOtherOrdersRemain() {
  await withFixturePage('other-orders-remain', { width: 1280, height: 800 }, async (page) => {
    await openDemoTable(page);
    await returnFullFirstRow(page, 2);

    assert.equal(await page.locator('.table-item-summary-row').count(), 2);
    assert.equal(
      await page.getByTestId('table-card-demo-table-1').getAttribute('data-status'),
      'IN_USE',
    );
    assert.doesNotMatch(
      (await page.getByTestId('table-detail').textContent()) || '',
      /当前桌台空闲/,
    );
    await assertSilentSuccess(page, 'emptying one order while other orders remain');
    await capture(page, '05-order-empty-other-orders-remain-1280x800.png');
  });
}

async function captureStaleQuantityError() {
  await withFixturePage('stale-quantity-error', { width: 1280, height: 800 }, async (page) => {
    await openDemoTable(page);
    const dialog = await openFirstReturnDialog(page);
    assert.equal((await dialog.locator('.item-return-quantity output').textContent())?.trim(), '1');

    // Simulate a safe concurrent write inside the explicitly enabled browser
    // Fixture. The visible dialog still carries expectedQuantity=3, while the
    // Fixture repository now has quantity=2, so the UI receives the same 409
    // conflict that a real stale cashier would receive.
    await page.evaluate(async () => {
      const { demoRepository } = await import('/src/fixtures/repository.ts');
      demoRepository.returnOrderItem('demo-order-1001', 'demo-order-1001-item', {
        requestKey: 'capture-concurrent-return',
        expectedQuantity: 3,
        returnQuantity: 1,
      });
    });

    await confirmReturn(page, dialog, { expectSuccess: false });
    const errorToast = page.locator('.cashier-toast--error');
    await errorToast.waitFor();
    assert.match((await errorToast.textContent()) || '', /菜品数量已变化，请刷新/);
    assert.equal(await page.locator('.cashier-toast--success').count(), 0);
    assert.equal(await page.locator('[role="alertdialog"]:visible').count(), 0);
    await capture(page, '06-stale-quantity-error-1280x800.png');
  });
}

async function captureSilentAddItemsFullPage() {
  await withFixturePage('silent-add-items', { width: 1280, height: 800 }, async (page) => {
    await openDemoTable(page);
    await page.getByTestId('table-order-items').click();
    const workspace = page.getByTestId('table-ordering-workspace');
    await workspace.waitFor();
    const firstProduct = workspace.locator('.table-ordering-product').first();
    await firstProduct.getByRole('button', { name: '增加数量', exact: true }).click();
    const confirm = workspace.getByTestId('confirm-table-order');
    assert.equal(await confirm.isEnabled(), true);
    await confirm.click();
    await workspace.waitFor({ state: 'detached' });
    await page.waitForFunction(() =>
      document.querySelectorAll('.table-item-summary-row').length === 4,
    );
    await assertSilentSuccess(page, 'adding items to an open table');
    await capture(page, '07-silent-add-items-full-page-1280x800.png', { fullPage: true });
  });
}

async function captureVietnameseDangerConfirmation() {
  await withFixturePage('vietnamese-danger', { width: 1280, height: 800 }, async (page) => {
    await openDemoTable(page);
    await prepareSingleRemainingItem(page);
    await selectLocale(page, 'vi');

    const dialog = await openFirstReturnDialog(page);
    const danger = dialog.getByTestId('last-item-return-danger');
    await danger.waitFor();
    assert.match(
      (await danger.textContent()) || '',
      /tự đóng.*bàn được giải phóng/,
      'Vietnamese danger copy must explain automatic closure and table release',
    );
    await assertDialogWithinViewport(page, dialog, 'Vietnamese final-item confirmation');
    assert.equal(await page.locator('.cashier-toast--success').count(), 0);
    await capture(page, '08-vietnamese-last-item-confirm-1280x800.png');
  });
}

async function withFixturePage(label, viewport, run) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });

  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.includes('/uploads/merchants/')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="18" fill="#19c37d"/><path d="M20 42h40M28 30h24M25 42v18M55 42v18" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>',
      });
      return;
    }
    if (['http:', 'https:'].includes(requestUrl.protocol) && !allowedHosts.has(requestUrl.hostname)) {
      networkViolations.push(`${label}: ${route.request().method()} ${requestUrl.origin}${requestUrl.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`${label} page: ${error.message}`));

  try {
    await page.goto(new URL('/login', configuredBaseUrl).href, { waitUntil: 'networkidle' });
    const demoEntry = page.getByTestId('enter-demo');
    assert.equal(
      await demoEntry.isVisible(),
      true,
      'Fixture entry is unavailable. Start Vite with VITE_CASHIER_USE_FIXTURES=true.',
    );
    await demoEntry.click();
    await page.waitForURL((url) => url.pathname === '/tables');
    await page.getByTestId('table-grid').waitFor();
    assert.equal(await page.locator('.demo-badge').count(), 1, 'The review must use a Fixture demo session');
    await run(page);
  } finally {
    await context.close();
  }
}

async function openDemoTable(page) {
  await page.getByTestId('table-card-demo-table-1').click();
  await page.waitForURL((url) => url.pathname === '/tables/demo-table-1');
  await page.getByTestId('table-detail').waitFor();
  await page.waitForFunction(() =>
    document.querySelectorAll('.table-item-summary-row').length === 3,
  );
}

async function prepareSingleRemainingItem(page) {
  await returnFullFirstRow(page, 2);
  await returnFullFirstRow(page, 1);
  await returnOneFromFirstRow(page);
  await assertTableItemState(page, { rows: 1, quantity: 1, status: 'IN_USE' });
}

async function returnFullFirstRow(page, expectedRemainingRows) {
  const dialog = await openFirstReturnDialog(page);
  const increase = dialog.locator('.item-return-quantity button').nth(1);
  let clicks = 0;
  while (!(await increase.isDisabled())) {
    await increase.click();
    clicks += 1;
    assert.ok(clicks < 100, 'Fixture return quantity did not reach its maximum');
  }
  await dialog.getByTestId('last-item-return-danger').waitFor();
  await confirmReturn(page, dialog);
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.table-item-summary-row').length === expected,
    expectedRemainingRows,
  );
  await assertSilentSuccess(page, 'returning a full single-line order');
}

async function returnOneFromFirstRow(page) {
  const rowsBefore = await page.locator('.table-item-summary-row').count();
  const dialog = await openFirstReturnDialog(page);
  assert.equal((await dialog.locator('.item-return-quantity output').textContent())?.trim(), '1');
  assert.equal(await dialog.getByTestId('last-item-return-danger').count(), 0);
  await confirmReturn(page, dialog);
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.table-item-summary-row').length === expected,
    rowsBefore,
  );
  await assertSilentSuccess(page, 'returning one unit from a multi-quantity item');
}

async function openFirstReturnDialog(page) {
  const row = page.locator('.table-item-summary-row').first();
  await row.waitFor();
  const button = row.getByTestId('decrease-order-item');
  assert.equal(await button.isEnabled(), true, 'The return control must be enabled');
  await button.click();
  const dialog = page.getByTestId('return-item-dialog');
  await dialog.waitFor();
  return dialog;
}

async function confirmReturn(page, dialog, options = {}) {
  await dialog.locator('footer .primary-action').click();
  await dialog.waitFor({ state: 'detached' });
  if (options.expectSuccess !== false) await assertSilentSuccess(page, 'confirmed return');
}

async function assertTableItemState(page, { rows, quantity, status }) {
  await page.waitForFunction(
    ({ expectedRows, expectedQuantity, expectedStatus }) => {
      const itemRows = [...document.querySelectorAll('.table-item-summary-row')];
      const table = document.querySelector('[data-testid="table-card-demo-table-1"]');
      return itemRows.length === expectedRows
        && Boolean(itemRows[0]?.textContent?.includes(`× ${expectedQuantity}`))
        && table?.getAttribute('data-status') === expectedStatus;
    },
    { expectedRows: rows, expectedQuantity: quantity, expectedStatus: status },
  );
}

async function assertSilentSuccess(page, label) {
  await page.waitForTimeout(80);
  assert.equal(
    await page.locator('.cashier-toast').count(),
    0,
    `${label} must not show any success toast or replacement notification`,
  );
  assert.equal(
    await page.locator('[role="alertdialog"]:visible').count(),
    0,
    `${label} must not leave a success dialog visible`,
  );
}

async function selectLocale(page, locale) {
  const trigger = page.getByTestId('employee-menu-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.getByTestId('employee-menu-popover').locator('select').selectOption(locale);
  await page.waitForFunction(
    (expectedLocale) => document.documentElement.lang === expectedLocale,
    locale === 'zh' ? 'zh-CN' : locale,
  );
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
}

async function assertDialogWithinViewport(page, dialog, label) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, `${label} must have measurable geometry`);
  assert.ok(box.x >= 0 && box.y >= 0, `${label} starts outside the viewport`);
  assert.ok(box.x + box.width <= viewport.width, `${label} overflows horizontally`);
  assert.ok(box.y + box.height <= viewport.height, `${label} overflows vertically`);
  assert.equal(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    true,
    `${label} text overflows its container`,
  );
  const buttons = dialog.locator('footer button');
  assert.equal(await buttons.count(), 2, `${label} must retain cancel and confirm actions`);
  assert.equal(await buttons.nth(0).isVisible(), true);
  assert.equal(await buttons.nth(1).isVisible(), true);
}

async function capture(page, fileName, options = {}) {
  assert.equal(captureNames.has(fileName), false, `Duplicate screenshot name: ${fileName}`);
  captureNames.add(fileName);
  await page.evaluate(() => document.fonts.ready);
  await auditScreenshotSafety(page, fileName);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(80);
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: options.fullPage ?? false,
    animations: 'disabled',
  });
  screenshotWrites += 1;
}

async function auditScreenshotSafety(page, label) {
  const evidence = await page.evaluate(() => ({
    text: document.body.innerText,
    cookie: document.cookie,
    storage: [
      ...Object.entries(localStorage),
      ...Object.entries(sessionStorage),
    ],
    href: window.location.href,
  }));
  assert.equal(evidence.cookie, '', `${label} must not capture cookies`);
  assert.equal(
    evidence.storage.some(([key, value]) =>
      /token|password|secret|api[-_]?key/i.test(`${key} ${value}`),
    ),
    false,
    `${label} must not retain sensitive browser storage`,
  );
  assert.doesNotMatch(
    evidence.text,
    /Bearer\s+[A-Za-z0-9._~-]+|access[_ -]?token|api[_ -]?key|password\s*[:=]/i,
    `${label} contains secret-like visible text`,
  );
  const screenshotUrl = new URL(evidence.href);
  assert.equal(allowedHosts.has(screenshotUrl.hostname), true);
  assert.equal(
    [...screenshotUrl.searchParams.keys()].some((key) => /token|password|secret|key/i.test(key)),
    false,
    `${label} URL contains a sensitive query parameter`,
  );
}
