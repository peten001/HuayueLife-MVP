import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAcceptanceState } from './local-acceptance-fixtures.mjs';
const require = createRequire(new URL('../../merchant-cashier/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:4198';
const output = '/tmp/yunqiao-merchant-phase2-20260906';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { source: 'Browser-only isolated samples; no production and no printer execution', checks: [], views: [], errors: [] };
const pass = name => { evidence.checks.push(name); console.log('PASS', name); };
const envelope = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK', data }) });
const stamp = '2026-09-05T12:00:00Z';
const printers = ['前台收银 · 本地样例', '厨房出餐 · 本地样例'].map((name, i) => ({
  id: 'sample-printer-' + i, name, channelType: 'LOCAL_LAN_ESCPOS', paperWidth: 'MM80', purpose: i ? 'KITCHEN' : 'FRONT_DESK', enabled: false, status: 'OFFLINE', connectionConfig: {},
  lan: { adminState: 'WAITING_TERMINAL', terminalId: null, localBindingId: null, endpoint: null, terminal: null, serviceRunning: false, executionEnabled: false, lastTest: null, canTest: false, canEnable: false }, createdAt: stamp, updatedAt: stamp,
}));
const jobs = ['PENDING', 'FAILED', 'SUCCEEDED'].map((status, i) => ({ id: 'local-job-' + i, printerId: printers[0].id, printer: printers[0], orderId: 'sample-order', order: { orderNo: 'LOCAL-UI-PRINT-' + i }, receiptType: 'ORDER_CUSTOMER', triggerEvent: 'MANUAL', source: 'MANUAL', status, priority: 0, attemptCount: i ? 1 : 0, maxAttempts: 3, availableAt: stamp, createdAt: stamp, updatedAt: stamp, receiptSnapshot: {}, lastErrorMessage: i === 1 ? '本地错误态：设备未连接。此记录不是实际打印。' : null }));
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const writes = [];
  page.on('pageerror', e => evidence.errors.push(e.message));
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) writes.push(r.url()); });
  const noOverflow = async name => {
    const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, dialog: [...document.querySelectorAll('dialog[open],.printing-modal')].map(e => ({ width: e.clientWidth, scroll: e.scrollWidth, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right })) }));
    evidence.views.push({ name, ...result });
    assert(result.scrollWidth <= result.width, name + ' document overflow');
    assert(result.dialog.every(d => d.scroll <= d.width && d.left >= 0 && d.right <= result.width), name + ' dialog overflow');
  };
  const closeNative = async () => { await page.keyboard.press('Escape'); await expect(page.locator('dialog[open]')).toHaveCount(0); assert.equal(await page.evaluate(() => document.body.style.overflow), ''); };
  await page.goto(base + '/dashboard');
  await expect(page.locator('.business-analytics-page')).toBeVisible();
  await expect(page.locator('[data-analytics-field="revenue"]')).toHaveText('₫3,270,000');
  await expect(page.locator('.business-analytics-page canvas')).toHaveCount(2);
  await expect(page.locator('[data-analytics-panel="funds-overview"]')).toBeVisible();
  await expect(page.locator('[data-analytics-panel="time-analysis"]')).toBeVisible();
  await expect(page.locator('[data-analytics-panel="time-revenue-share"]')).toBeVisible();
  await expect(page.locator('[data-analytics-panel="top-five"]')).toBeVisible();
  await page.locator('.analytics-preset').filter({ hasText: '自定义' }).click();
  await expect(page.locator('.analytics-custom-dates')).toBeVisible();
  await noOverflow('formal analytics custom dates');
  await page.screenshot({ path: output + '/formal-analytics-mobile.png', fullPage: true });
  pass('homepage reuses the full production Business Analytics structure and controls');

  await page.goto(base + '/tables');
  await expect(page.locator('.mx-floor-table')).toHaveCount(12);
  const addTable = page.locator('.mx-heading > button');
  await addTable.click(); await expect(page.locator('dialog[open] .mx-form')).toBeVisible();
  await noOverflow('table create'); await closeNative(); await expect(addTable).toBeFocused();
  const table = page.locator('.mx-floor-table').first();
  await table.locator('footer button').first().click();
  await expect(page.locator('dialog[open] .mx-bill-total')).toBeVisible();
  assert.equal(await page.locator('dialog[open] .mx-receipt-row').first().evaluate(e => getComputedStyle(e).display), 'grid', 'bill quantities and subtotals use distinct columns');
  await noOverflow('table bill'); await page.screenshot({ path: output + '/phase2-mobile-table-bill.png' });
  await closeNative();
  await page.route('**/merchant/tables/t0', r => r.request().method() === 'PATCH' ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '本地模拟保存失败' }) }) : r.continue());
  await table.locator('header button').click();
  await page.locator('dialog[open] .mx-table-menu button').first().click();
  await page.locator('dialog[open] button[type=submit]').click();
  await expect(page.locator('dialog[open] [role=alert]')).toContainText('本地模拟保存失败');
  await expect(page.locator('dialog[open] input').first()).toHaveValue('A01');
  await closeNative();
  await table.locator('header button').click();
  await page.locator('dialog[open] .mx-table-menu button').first().click();
  await expect(page.locator('dialog[open] .mx-form')).toBeVisible();
  await closeNative();
  await page.evaluate(() => scrollTo(0, 400)); assert(await page.evaluate(() => scrollY > 0));
  pass('table create/bill/settings-to-edit dialogs restore scroll and focus, no cashier action');

  await page.goto(base + '/menu/products');
  const dish = page.locator('.mx-mobile-product').first();
  await dish.click(); await page.locator('dialog[open]').getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('dialog[open] .mx-product-editor')).toBeVisible();
  await closeNative(); await expect(dish).toBeFocused();
  pass('product detail-to-edit hand-off does not leak a body scroll lock and restores the original row');

  await page.goto(base + '/staff');
  await expect(page.locator('.mx-team-row')).toHaveCount(3);
  await page.locator('.mx-heading > button').click();
  await page.locator('dialog[open] button[type=submit]').click();
  assert.equal(await page.locator('dialog[open] form').evaluate(e => e.checkValidity()), false);
  await noOverflow('staff invalid create'); await closeNative();
  await page.locator('.mx-team-row').nth(1).locator('.mx-action-menu summary').click();
  await page.locator('.mx-team-row').nth(1).getByRole('menuitem', { name: '编辑', exact: true }).click();
  await expect(page.locator('dialog[open] input').nth(1)).toBeDisabled();
  await page.route('**/merchant/staff/local-manager', r => r.request().method() === 'PATCH' ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '本地模拟员工保存失败' }) }) : r.continue());
  await page.locator('dialog[open] button[type=submit]').click();
  await expect(page.locator('dialog[open] [role=alert]')).toContainText('本地模拟员工保存失败');
  await closeNative();
  await page.locator('.mx-team-row').nth(1).locator('.mx-action-menu summary').click();
  await expect(page.locator('.mx-action-menu[open]')).toHaveCount(1);
  await page.locator('.mx-panel-heading').click();
  await expect(page.locator('.mx-action-menu[open]')).toHaveCount(0);
  pass('staff create validation, immutable login in edit, and outside-click menu dismissal');

  await page.goto(base + '/merchant/profile');
  await expect(page.locator('.hours-row')).toHaveCount(7);
  await page.locator('.mx-settings-nav button').nth(2).click();
  const notice = page.locator('textarea:visible'); const original = await notice.inputValue();
  await notice.fill(original + '\n本地未保存草稿');
  await page.locator('.mx-settings-nav button').first().click();
  await expect(page.locator('.interval b').first()).toBeVisible();
  await page.locator('.mx-settings-nav button').nth(2).click();
  await expect(notice).toHaveValue(original + '\n本地未保存草稿');
  await notice.fill(original); await noOverflow('settings unsaved draft');
  pass('settings navigation preserves unsaved fields and overnight time indicators');

  const sample = createAcceptanceState();
  const preview = sample.respond('/merchant/order-voids/order%3Ao0/preview', new URLSearchParams(), 'GET', {}, 'OWNER');
  const voidRecord = { ...preview, operationId: 'local-ui-void', voidedAt: stamp, actor: { id: 'local-owner', displayName: '本地样例店主' }, reason: 'TEST', note: '仅用于界面测试，未作废任何订单' };
  await page.route('**/merchant/order-voids?*', r => r.fulfill(envelope({ items: [voidRecord], total: 1, hasMore: false })));
  await page.goto(base + '/orders?date=2026-09-05');
  await page.getByRole('button', { name: '更多订单操作', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '已删除', exact: true }).click();
  await page.locator('.mx-void-row').click(); await expect(page.locator('dialog[open] .void-evidence')).toBeVisible();
  await noOverflow('void audit drawer'); await page.screenshot({ path: output + '/phase2-void-audit-mobile.png' }); await closeNative();
  pass('void archive row drills into preserved financial and actor evidence, no deletion');

  await page.route('**/merchant/printing/printers', r => r.fulfill(envelope(printers)));
  await page.route(/\/merchant\/printing\/jobs(?:\?.*)?$/, r => r.fulfill(envelope(jobs)));
  await page.route('**/merchant/printing/jobs/local-job-*', r => r.fulfill(envelope(jobs.find(j => r.request().url().endsWith(j.id)))));
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/printing-center/printers');
    await expect(page.locator('.mx-printer-device')).toHaveCount(2);
    await noOverflow('populated printer directory ' + width);
    if ([1440, 390].includes(width)) await page.screenshot({ path: output + '/phase2-printers-' + width + '.png', fullPage: true });
    await page.locator('.mx-printer-device').first().locator('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible(); await noOverflow('printer instructions ' + width);
    await page.getByRole('dialog').locator('.printing-modal__close').click();
    await page.goto(base + '/printing-center/jobs');
    await expect(page.locator('.mx-print-record')).toHaveCount(3);
    await noOverflow('populated printing ledger ' + width);
    if ([1440, 390].includes(width)) await page.screenshot({ path: output + '/phase2-jobs-' + width + '.png', fullPage: true });
    await page.locator('.mx-print-reference').nth(1).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await noOverflow('print failure detail ' + width);
    const retry = page.locator('dialog[open] .printing-modal__footer button').nth(1);
    if (await retry.count()) {
      await retry.click(); await expect(page.locator('dialog[open]')).toHaveCount(2);
      await page.keyboard.press('Escape'); await expect(page.locator('dialog[open]')).toHaveCount(1);
      await expect(retry).toBeFocused();
    }
    await page.getByRole('dialog').locator('.printing-modal__footer button').first().click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  }
  pass('populated printer directory and job ledger/detail at six widths, execution controls not triggered');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/more');
  await expect(page.locator('.mx-more-row')).toHaveCount(5);
  await expect(page.locator('.m-logout')).toHaveCount(0);
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await noOverflow('minimal more page ' + width); }
  await page.screenshot({ path: output + '/phase2-more-mobile.png' });
  pass('More retains only language and four requested management destinations');
  assert.deepEqual(writes, [base + '/__local/api/v1/merchant/tables/t0', base + '/__local/api/v1/merchant/staff/local-manager'], 'only two browser-intercepted save failures; no actual mutations or printer execution');
  assert.deepEqual(evidence.errors, [], 'no browser runtime errors');
  await context.close();
} catch (error) { evidence.failure = String(error); throw error; }
finally { await writeFile(output + '/phase2-interactions.json', JSON.stringify(evidence, null, 2)); await browser.close(); }
