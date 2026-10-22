/** Guarded loopback API and source previews only. No production accounts or writes. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const config = JSON.parse(readFileSync('/tmp/huayue-arrival-preview.json', 'utf8'));
const out = resolve(process.env.PICKUP_SIMPLE_OUTPUT || '/tmp/yunqiao-pickup-simplify-20261021/browser');
mkdirSync(out, { recursive: true });
const report = { pass: false, flows: [], layouts: [], errors: [] };
const api = async (path, method = 'GET', body, token = config.staffToken) => {
  const response = await fetch('http://127.0.0.1:34120/api/v1' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json(); assert(response.ok, `${method} ${path}: ${response.status} ${payload.message || ''}`); return payload.data;
};
await api('/merchant/profile', 'PATCH', { businessHours: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day, ['00:00-24:00']])) });
const products = await api('/merchant/products?status=ON_SALE');
const miniUrl = (page, extra = {}) => 'http://127.0.0.1:34121/?' + new URLSearchParams({ page, merchantId: config.merchantId, width: '390', locale: 'zh', ...extra });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageFor = async context => { const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push(error.message)); return page; };
async function dismiss(page) {
  const inbox = page.locator('[data-testid="new-order-inbox"]');
  if (await inbox.isVisible()) await page.locator('.new-order-inbox__panel header button').click();
  const push = page.locator('.order-push-control__close'); if (await push.isVisible()) await push.click();
  for (const button of await page.locator('.cashier-toast button').all()) await button.click();
}
async function capture(page, name) { await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true }); }
async function staffContext(width = 1366, locale = 'zh') {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(({ config, locale }) => {
    localStorage.setItem('yunqiao_cashier_access_token', config.staffToken);
    localStorage.setItem('yunqiao_cashier_staff_session', JSON.stringify(config.staffSession));
    localStorage.setItem('yunqiao_cashier_locale', locale);
  }, { config, locale }); return context;
}
const getOrder = id => api(`/orders/${id}`, 'GET', undefined, config.userToken);
const legacyOrder = async () => {
  await api('/cart/items', 'POST', { merchantId: config.merchantId, orderType: 'PICKUP', reservation: true, productId: products[0].id, quantity: 1 }, config.userToken);
  return api('/orders', 'POST', { merchantId: config.merchantId, orderType: 'PICKUP', reservation: true, scheduledFor: new Date(Date.now() + 14400000).toISOString(),
    contactName: '历史自取验收', contactPhone: '0901234567', expectedAmountVnd: products[0].priceVnd }, config.userToken);
};
try {
  const miniContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mini = await pageFor(miniContext);
  await mini.goto(miniUrl('merchant'));
  await mini.locator('.sticky-actions button.pickup').click();
  await mini.locator('.reservation-choice').filter({ hasText: '打包自取' }).click();
  await mini.locator('button.add,button.quantity-plus').first().waitFor();
  assert.equal(new URL(mini.url()).searchParams.get('reservation'), null);
  await mini.locator('button.add,button.quantity-plus').first().click();
  await mini.locator('.cart-bar button:not(:disabled)').click();
  await mini.locator('button.submit').click();
  await mini.waitForURL(url => url.searchParams.get('page') === 'checkout');
  await mini.locator('.contact-card input').first().fill('普通自取验收');
  await mini.locator('.contact-card input').nth(1).fill('0901234567');
  assert.equal(await mini.locator('.reservation-card, .time-modes, .preview-picker-input').count(), 0);
  await capture(mini, '01-miniapp-ordinary-checkout');
  const submitted = mini.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
  await mini.locator('button.submit').click();
  const response = await submitted; assert(response.ok());
  const request = response.request().postDataJSON();
  assert.equal(request.orderType, 'PICKUP'); assert(!request.reservation && !request.scheduledFor);
  await mini.waitForURL(url => url.searchParams.get('page') === 'order');
  const order = await getOrder(new URL(mini.url()).searchParams.get('id'));
  assert.equal(order.isReservation, false); assert.equal(order.status, 'PENDING_ACCEPTANCE');
  await mini.locator('.status-card').waitFor(); await capture(mini, '02-miniapp-pending-order');
  report.flows.push('merchant appointment entrance → pickup menu → cart → ordinary checkout → ordinary pickup order');

  const context = await staffContext(); const cashier = await pageFor(context);
  await cashier.goto(`http://127.0.0.1:34122/pickup/${order.id}`);
  await cashier.locator('.pickup-order-detail').waitFor(); await dismiss(cashier);
  await cashier.locator('.fulfillment-action-dock .primary-action').click();
  await cashier.locator('.fulfillment-action-dock .primary-action').filter({ hasText: '制作完成' }).waitFor();
  assert.equal((await getOrder(order.id)).status, 'PREPARING');
  assert(JSON.stringify(await api('/merchant/kds')).includes(order.orderNo), 'Accepted pickup is sent to the kitchen');
  await capture(cashier, '03-cashier-making');
  await cashier.locator('.fulfillment-action-dock .primary-action').click();
  await cashier.locator('.fulfillment-action-dock .primary-action').filter({ hasText: '确认取餐' }).waitFor();
  await cashier.locator('.fulfillment-action-dock .primary-action').click();
  await cashier.locator('.payment-option').first().click();
  await cashier.locator('.payment-dialog .primary-action').click();
  await cashier.waitForURL(url => url.pathname.includes('/orders/history/'));
  assert.equal((await getOrder(order.id)).status, 'COMPLETED');
  assert.equal((await getOrder(order.id)).paymentMethod, 'CASH');
  report.flows.push('one accept action → making and KDS → ready → pickup and cash receipt → completed history');

  const legacy = await legacyOrder();
  await api(`/merchant/reservations/PICKUP/${legacy.id}/actions`, 'POST', { action: 'PROPOSE_TIME', scheduledFor: new Date(Date.now() + 18000000).toISOString() });
  await cashier.goto(`http://127.0.0.1:34122/pickup/${legacy.id}`);
  await cashier.locator('.pickup-order-detail').waitFor(); await dismiss(cashier);
  assert.equal(await cashier.locator('.pickup-reservation-controls').count(), 0);
  await cashier.locator('.fulfillment-action-dock .primary-action').click();
  await cashier.locator('.fulfillment-action-dock .primary-action').filter({ hasText: '制作完成' }).waitFor();
  const prepared = await getOrder(legacy.id);
  assert.equal(prepared.status, 'PREPARING'); assert.equal(prepared.proposedScheduledFor, null); assert.equal(prepared.scheduledFor, legacy.scheduledFor);
  assert((await cashier.locator('.fulfillment-facts').innerText()).includes('取餐时间'));
  report.flows.push('historical scheduled pickup with pending time proposal accepts directly into making and retains its recorded time');

  for (const width of [320,390,768,1280]) for (const locale of ['zh','vi','en']) {
    const ctx = await staffContext(width, locale); const page = await pageFor(ctx);
    await page.goto('http://127.0.0.1:34122/pickup?status=DUE');
    await page.locator('.pickup-order-card').first().waitFor(); await dismiss(page);
    assert.equal(new URL(page.url()).searchParams.get('status'), 'PREPARING');
    const selector = width < 900 ? '.mobile-v2-filter-strip button' : '.pickup-queue-toolbar .workflow-filter-chips button';
    assert.equal(await page.locator(selector).count(), 4);
    const text = await page.locator('.pickup-page').innerText(); assert(!text.includes('待备餐') && !text.includes('该备餐'));
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(geometry.scroll <= geometry.width + 1);
    await capture(page, `04-pickup-${width}-${locale}`); report.layouts.push({ width, locale, ...geometry }); await ctx.close();
  }
  await api('/cart/items', 'POST', { merchantId: config.merchantId, orderType: 'PICKUP', productId: products[0].id, quantity: 1 }, config.userToken);
  await mini.evaluate(config => localStorage.setItem('arrival-preview:huayue_cart_context', JSON.stringify({ merchantId: config.merchantId, orderType: 'PICKUP', reservation: true })), config);
  await mini.goto(miniUrl('create', { kind: 'PICKUP' }));
  await mini.waitForURL(url => url.searchParams.get('page') === 'menu');
  await mini.locator('.cart-bar button:not(:disabled)').waitFor();
  const stored = await mini.evaluate(() => JSON.parse(localStorage.getItem('arrival-preview:huayue_cart_context')));
  assert(!stored.reservation); assert.equal(stored.orderType, 'PICKUP');
  await mini.locator('.cart-bar button:not(:disabled)').click(); await mini.locator('button.submit').click();
  await mini.waitForURL(url => url.searchParams.get('page') === 'checkout');
  report.flows.push('old pickup reservation URL and cached reservation cart return to ordinary checkout without losing dishes');
  await mini.goto(miniUrl('create', { kind: 'DINE_IN' }));
  await mini.locator('.reservation-card').first().waitFor();
  await mini.locator('.contact-input').first().fill('用餐预约验收'); await mini.locator('.contact-input').nth(1).fill('0901234567');
  const bookingResponse = mini.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/reservations' && response.request().method() === 'POST');
  await mini.locator('.primary-button').click();
  const booking = await bookingResponse; assert(booking.ok()); assert.equal(booking.request().postDataJSON().withCart, false);
  await mini.waitForURL(url => url.searchParams.get('page') === 'reservation');
  report.flows.push('dining remains seats-only booking with its existing time, guest count and confirmation workflow');
  assert.deepEqual(report.errors, []); report.pass = true;
} catch (error) {
  for (const ctx of browser.contexts()) for (const page of ctx.pages()) {
    await page.screenshot({ path: resolve(out, `debug-${browser.contexts().indexOf(ctx)}-${ctx.pages().indexOf(page)}.png`), fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ url: page.url(), text: (await page.locator('body').innerText()).slice(0, 1800) }));
  }
  throw error;
} finally {
  writeFileSync(resolve(out, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close();
}
console.log(JSON.stringify({ pass: report.pass, flows: report.flows.length, layouts: report.layouts.length, errors: report.errors }));
