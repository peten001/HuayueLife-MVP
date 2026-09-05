import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../merchant-cashier/package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');
const browserName = process.env.ORDER_VOID_UI_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(browserName));
const menuOnly = process.env.ORDER_VOID_UI_MENU_ONLY === '1';
const base = process.env.ORDER_VOID_UI_URL || 'http://127.0.0.1:4198';
const output = process.env.ORDER_VOID_UI_OUTPUT || '/tmp/yunqiao-order-void-ui';
await mkdir(output, { recursive: true });
const date = '2026-09-04';
const instant = `${date}T05:00:00.000Z`;
const order = { id: '9001', orderNo: 'FIXTURE-9001', merchantId: '9000', orderType: 'PICKUP', status: 'COMPLETED',
  itemAmountVnd: '206000', deliveryFeeVnd: '0', totalAmountVnd: '206000', settlementStatus: 'SETTLED',
  createdAt: instant, completedAt: instant, updatedAt: instant, contactName: 'UI test fixture',
  items: [{ id: '9901', productNameZhSnapshot: '酸辣蕨根粉', quantity: 2, unitPriceVnd: '103000', subtotalVnd: '206000' }], statusLogs: [] };
const settlement = { settlementId: 'order:9001', kind: 'ORDER', orderType: 'PICKUP', status: 'COMPLETED', businessDate: date,
  settledAt: instant, tableSessionId: null, tableId: null, tableName: null, orderIds: ['9001'], orderNos: ['FIXTURE-9001'], orderCount: 1,
  itemQuantity: 2, originalAmountVnd: '206000', discountAmountVnd: '0', roundingAmountVnd: '0', finalReceivableVnd: '206000', paymentMethod: 'CASH',
  items: [{ id: '9901', productId: '1', productNameZh: '酸辣蕨根粉', productNameVi: 'Miến trộn chua cay', productNameEn: 'Spicy fern noodles', quantity: 2, unitPriceVnd: '103000', subtotalVnd: '206000', remark: null }],
  sourceOrders: [{ ...order, paymentMethod: 'CASH' }], invariantViolations: [] };
const preview = { target: 'order:9001', version: 'a'.repeat(64), settlement, affectedOrderIds: ['9001'], affectedOrderNos: ['FIXTURE-9001'],
  businessDayImpacts: [{ businessDate: date, orderCount: 1, grossAmountVnd: '206000', discountAmountVnd: '0', roundingAmountVnd: '0', netSettledAmountVnd: '206000', cashRevenueVnd: '206000', bankTransferRevenueVnd: '0', unrecordedRevenueVnd: '0' }],
  settlementImpact: { businessDate: date, settlementCount: 1, revenueVnd: '206000' } };
const record = { ...preview, operationId: 'ui-fixture-operation', voidedAt: '2026-09-05T05:00:00Z', actor: { id: '9002', displayName: 'Fixture owner' }, reason: 'OTHER', note: 'UI fixture reason' };
const capabilities = [{ code: 'onlineOrderEnabled', isEnabled: true }];
const merchant = { id: '9000', nameZh: '隔离 UI 测试商家', status: 'ACTIVE', merchantMode: 'ORDER', capabilities };
const result = { dataSource: 'Mocked API fixtures, not production', browser: browserName,
  scope: menuOnly ? 'action menu geometry and touch targets only; dialog keyboard flow not run' : 'full regression',
  views: [], menus: [], errors: [], interactions: [] };
const browser = await (browserName === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ channel: 'chrome', headless: true }));
let lastPage;
async function contextFor(locale, width, role = 'OWNER', dineIn = false) {
  const context = await browser.newContext({ viewport: { width, height: width > 768 ? 900 : 844 }, isMobile: width <= 768, hasTouch: width <= 768, reducedMotion: 'reduce' });
  const page = await context.newPage();
  lastPage = page;
  let voided = false; let failPost = false; let stalePost = false; const posts = [];
  const currentSettlement = dineIn ? { ...settlement, settlementId: 'session:9003', kind: 'TABLE_SESSION', orderType: 'DINE_IN', tableSessionId: '9003', tableId: '9004', tableName: 'A05', orderCount: 2 } : settlement;
  const currentPreview = dineIn ? { ...preview, target: 'session:9003', settlement: currentSettlement, affectedOrderIds: ['9001', '9005', '9006'], affectedOrderNos: ['FIXTURE-9001', 'FIXTURE-9005', 'FIXTURE-CANCELLED-9006'] } : preview;
  const currentRecord = { ...record, ...currentPreview };
  await page.addInitScript(({ locale, role, merchant }) => {
    localStorage.setItem('huayue_merchant_token', 'isolated-ui-fixture');
    localStorage.setItem('huayue_merchant_locale', locale);
    localStorage.setItem('huayue_merchant_staff', JSON.stringify({ id: '9002', role, mustChangePassword: false, displayName: 'Fixture owner', merchant }));
  }, { locale, role, merchant });
  page.on('pageerror', error => result.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!url.pathname.includes('/api/v1/')) {
      if (url.origin === base) return route.continue();
      return route.abort();
    }
    const path = decodeURIComponent(url.pathname.split('/api/v1')[1]);
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    if (path === '/merchant/me') return respond({ user: { sub: '9002', role, username: 'Fixture owner', merchantId: '9000', mustChangePassword: false, merchant } });
    if (path === '/merchant/printing/feature-state') return respond({ taskCenterEnabled: true, automaticCreationEnabled: false, executionEnabled: false, lanPrintingEnabled: false, legacyPrintingEnabled: false, merchantPrintingEnabled: false, executionState: 'CONNECTOR_PENDING' });
    if (path === '/merchant/orders/9001') return respond(dineIn ? { ...order, orderType: 'DINE_IN', tableSessionId: '9003' } : order);
    if (path.endsWith('/preview')) {
      if (dineIn && path.includes('order:9001')) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'VOID_WHOLE_SESSION_REQUIRED', target: 'session:9003' }) });
      return respond(voided ? currentRecord : currentPreview);
    }
    if (path === `/merchant/order-voids/${currentPreview.target}` && request.method() === 'POST') {
      posts.push(request.postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 250));
      if (failPost || stalePost) {
        const code = stalePost ? 'VOID_PREVIEW_STALE' : 'TEST_NETWORK_ERROR';
        return route.fulfill({ status: stalePost ? 409 : 503, contentType: 'application/json', body: JSON.stringify({ code, message: 'Fixture network failure' }) });
      }
      voided = true; return respond(currentRecord, 201);
    }
    if (path === '/merchant/order-voids') {
      const matches = !url.searchParams.get('date') || url.searchParams.get('date') === date;
      return respond({ items: matches ? [currentRecord] : [], total: matches ? 1 : 0, hasMore: false });
    }
    if (path === '/merchant/settlements') return respond({ items: voided ? [] : [currentSettlement], total: voided ? 0 : 1 });
    if (path === '/merchant/orders/business-day-summary') return respond({ businessDate: date });
    if (path === '/merchant/orders/summary') {
      const bucket = { count: voided ? 0 : 1, amountVnd: voided ? '0' : '206000' };
      return respond({ ALL: bucket, DINE_IN: { count: 0, amountVnd: '0' }, PICKUP: bucket, DELIVERY: { count: 0, amountVnd: '0' }, ABNORMAL: { count: 0, amountVnd: '0' }, COMPLETED: { ...bucket, settlementCount: bucket.count, cashRevenueVnd: bucket.amountVnd, bankTransferRevenueVnd: '0', unrecordedRevenueVnd: '0', grossAmountVnd: bucket.amountVnd, discountAmountVnd: '0', roundingAmountVnd: '0' }, statusBreakdown: { COMPLETED: bucket.count } });
    }
    if (path === '/merchant/orders') return respond(voided ? [] : [order]);
    return respond({});
  });
  return { context, page, posts, fail(value) { failPost = value; }, stale(value) { stalePost = value; } };
}
async function checkMenu(page) {
  await page.locator('.void-menu summary').click();
  const geometry = await page.locator('.void-menu-panel').evaluate(panel => {
    const button = panel.querySelector('button');
    const bounds = panel.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: innerWidth,
      buttonOverflow: button.scrollWidth - button.clientWidth, buttonHeight: target.height,
      clickable: [target.left + 4, (target.left + target.right) / 2, target.right - 4].every(x =>
        button.contains(document.elementFromPoint(x, (target.top + target.bottom) / 2))) };
  });
  const locale = await page.evaluate(() => localStorage.getItem('huayue_merchant_locale'));
  const surface = await page.locator('.settlement-dialog').count() ? 'settlement' : 'order-detail';
  await page.screenshot({ path: `${output}/${locale}-${geometry.width}-${surface}-menu.png`, animations: 'disabled' });
  result.menus.push({ locale, surface, ...geometry });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1,
    `${surface} action menu stays inside the viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.buttonOverflow <= 1 && geometry.buttonHeight >= 44 && geometry.clickable,
    'the complete delete action is visible and clickable, including both label edges');
}
async function openAction(page) {
  await checkMenu(page);
  await page.locator('.void-menu .void-button--danger').click();
  await page.locator('.void-dialog[open] select').waitFor();
}
async function checkDialog(page, width) {
  const geometry = await page.locator('.void-dialog').evaluate(dialog => {
    const footer = dialog.querySelector('footer').getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, footerBottom: footer.bottom,
      overflow: dialog.scrollWidth - dialog.clientWidth, viewportHeight: innerHeight,
      buttons: [...dialog.querySelectorAll('header button, footer button')].map(button => ({ height: button.getBoundingClientRect().height, nowrap: getComputedStyle(button).whiteSpace })) };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.top >= 0);
  assert.ok(geometry.footerBottom <= geometry.viewportHeight + 1);
  assert.ok(geometry.overflow <= 1);
  assert.ok(geometry.buttons.every(button => button.height >= 44 && button.nowrap === 'nowrap'));
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))), true, 'focus stays inside native modal');
  }
  return geometry;
}
try {
  for (const locale of ['zh', 'vi', 'en']) for (const width of [1440, 1280, 1024, 768, 414, 390, 375, 320]) {
    const state = await contextFor(locale, width); const { page } = state;
    if (menuOnly) {
      await page.goto(`${base}/orders/9001`);
      await checkMenu(page);
      await page.locator('.void-menu summary').click();
      await checkMenu(page);
      assert.equal(state.posts.length, 0, 'opening and reopening the menu must never void an order');
      result.views.push({ locale, width });
      await state.context.close();
      continue;
    }
    await page.goto(`${base}/orders/9001`); await openAction(page);
    await page.screenshot({ path: `${output}/${locale}-${width}-dialog-initial.png`, animations: 'disabled' });
    assert.equal(await page.locator('.void-button--confirm').isDisabled(), true);
    const geometry = await checkDialog(page, width);
    await page.locator('.void-dialog select').selectOption('OTHER');
    assert.equal(await page.locator('.void-button--confirm').isDisabled(), true);
    await page.locator('.void-dialog textarea').fill('UI fixture reason');
    assert.equal(await page.locator('.void-button--confirm').isEnabled(), true);
    await page.screenshot({ path: `${output}/${locale}-${width}-dialog.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.void-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.locator('.void-menu summary').evaluate(element => document.activeElement === element), true);
    await page.goto(`${base}/orders`);
    await page.locator('.merchant-orders-page > .void-actions button').nth(1).click();
    await page.locator('.void-search input[type=date]').fill(date);
    await page.locator('.void-search button').click();
    await page.locator('.void-record > summary').click();
    await page.locator('.void-audit').waitFor();
    assert.ok(await page.locator('.void-history').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: `${output}/${locale}-${width}-archive.png`, fullPage: true, animations: 'disabled' });
    result.views.push({ locale, width, geometry }); await state.context.close();
  }
  if (!menuOnly) {
    const state = await contextFor('zh', 390); const { page } = state;
    await page.goto(`${base}/orders/9001`); await openAction(page);
    await page.locator('.void-dialog select').selectOption('OTHER'); await page.locator('.void-dialog textarea').fill('UI fixture reason');
    state.fail(true); await page.locator('.void-button--confirm').click();
    assert.equal(await page.locator('.void-button--confirm').isDisabled(), true);
    await page.getByText('Fixture network failure', { exact: true }).waitFor();
    assert.equal(await page.locator('.void-dialog textarea').inputValue(), 'UI fixture reason');
    await page.screenshot({ path: `${output}/error-retry.png` });
    state.fail(false); state.stale(true); await page.locator('.void-button--confirm').click();
    await page.getByText(/预览后数据已变化/).waitFor();
    assert.equal(await page.locator('.void-button--confirm').isDisabled(), true);
    state.stale(false); await page.getByRole('button', { name: '重新核对', exact: true }).click();
    await page.locator('.void-dialog select').waitFor();
    await page.locator('.void-button--confirm').click();
    await page.waitForURL(`${base}/orders`);
    assert.equal(state.posts.length, 3); assert.equal(new Set(state.posts.map(body => body.requestKey)).size, 1);
    result.interactions.push('required reason, no duplicate while submitting, failure preserves input, stale preview requires refresh, retry key reused, success refreshes list, escape and focus return');
    await state.context.close();
    for (const width of [1440, 768, 414, 390, 375, 320]) {
      const state = await contextFor('zh', width, 'OWNER', true); const { page } = state;
      await page.goto(`${base}/orders/9001`); await openAction(page);
      await page.locator('.void-dialog .void-evidence summary').click();
      await page.getByText('FIXTURE-CANCELLED-9006 · ID 9006', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.goto(`${base}/orders?status=COMPLETED`);
      if (width > 768) await page.locator('.orders-submit-button').click();
      else await page.locator('.orders-mobile-tab').filter({ hasText: '已完成' }).click();
      const details = page.getByRole('button', { name: '查看详情', exact: true });
      await details.filter({ visible: true }).click();
      await page.locator('.settlement-dialog').waitFor(); await openAction(page);
      await checkDialog(page, width);
      await page.locator('.void-dialog select').selectOption('TEST');
      await page.locator('.void-button--confirm').click();
      await page.locator('.settlement-dialog').waitFor({ state: 'detached' });
      await page.getByText('已作废，原记录和打印证据已保留。', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(state.posts.length, 1);
      result.interactions.push(`whole-session redirect includes cancelled child, completed-list nested dialog submits and refreshes at ${width}px`);
      await state.context.close();
    }
    for (const role of ['MANAGER', 'STAFF']) {
      const state = await contextFor('zh', 390, role);
      await state.page.goto(`${base}/orders/9001`); await state.page.locator('.order-operation').waitFor();
      assert.equal(await state.page.locator('.void-menu').count(), 0);
      await state.page.goto(`${base}/orders`); await state.page.locator('.merchant-orders-page').waitFor();
      assert.equal(await state.page.locator('.merchant-orders-page > .void-actions').count(), 0);
      await state.context.close();
    }
    assert.deepEqual(result.errors, []);
    const previewPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await previewPage.goto(`${base}/src/components/OrderVoidAction.preview.html`);
    assert.equal(await previewPage.locator('[data-state]').count(), 8);
    assert.equal(await previewPage.locator('[data-state="disabled"] button').isDisabled(), true);
    assert.ok(await previewPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await previewPage.screenshot({ path: `${output}/eight-states.png`, fullPage: true });
    await previewPage.close();
  }
  assert.deepEqual(result.errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(`PASS: ${result.views.length} locale/viewport combinations; ${result.scope}. ${output}`);
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error(lastPage.url(), await lastPage.locator('body').innerText());
  }
  throw error;
} finally { await browser.close(); }
