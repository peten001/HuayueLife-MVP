/** Requires the guarded local API and MiniApp source-preview servers. Never uses production. */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync('/tmp/huayue-arrival-preview.json', 'utf8'));
const output = resolve('..', '..', 'docs', 'ui-review', 'arrival-reservations');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.ARRIVAL_BROWSER_CHANNEL || 'chrome', headless: true });
const layoutsOnly = process.argv.includes('--layouts-only');
const previous = layoutsOnly && existsSync(resolve(output,'browser-validation.json')) ? JSON.parse(readFileSync(resolve(output,'browser-validation.json'),'utf8')) : null;
const report = { flows: previous?.flows ?? [], layouts: [], errors: [] };
const miniUrl = (page, options = {}) => `http://127.0.0.1:34121/?${new URLSearchParams({ page, merchantId: config.merchantId, width: '390', locale: 'zh', ...options })}`;
const tomorrow = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10);
const errorCollector = page => page.on('pageerror', error => report.errors.push(error.message));
async function dismissInbox(page) {
  const inbox = page.locator('[data-testid="new-order-inbox"]');
  await inbox.waitFor({state:'visible',timeout:1200}).catch(() => undefined);
  if (await inbox.isVisible()) await inbox.locator('.new-order-inbox__panel header button').click();
}
async function capture(page, filename) {
  const pushClose = page.locator('.order-push-control__close');
  if (await pushClose.isVisible()) await pushClose.click();
  for (const toast of await page.locator('.cashier-toast button').all()) await toast.click().catch(() => undefined);
  await page.screenshot({ path: resolve(output, filename), fullPage: true }); }
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(sizes.scroll <= sizes.width + 1, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
  const clippedCards = await page.locator('.reservation-list-card').evaluateAll(cards => cards.filter(card => card.scrollHeight > card.clientHeight + 2).map(card => ({height:card.clientHeight,scroll:card.scrollHeight})));
  assert.deepEqual(clippedCards, [], `${label}: clipped reservation cards`);
  report.layouts.push({ label, ...sizes, pass: true });
}

try {
  if (!layoutsOnly) {
  const tableResponse = await fetch('http://127.0.0.1:34120/api/v1/merchant/tables', { method:'POST', headers: {Authorization:`Bearer ${config.staffToken}`,'Content-Type':'application/json'}, body:JSON.stringify({tableNo:`UI${Date.now()}`,tableName:'预约验收空闲桌'}) });
  assert(tableResponse.ok, 'Create a disposable test table before the seating flow');
  const customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mini = await customer.newPage(); errorCollector(mini);
  await mini.goto(miniUrl('merchant'));
  await mini.getByRole('button', { name: '预约到店', exact: true }).click();
  await mini.waitForSelector('.reservation-sheet');
  assert.equal(await mini.locator('.reservation-choice').count(), 2);
  await capture(mini, '03-miniapp-arrival-choice.png');
  await mini.locator('.reservation-choice').filter({ hasText: '到店用餐' }).click();
  await mini.waitForSelector('.reservation-card');
  await mini.locator('.contact-row input').nth(0).fill('张先生');
  await mini.locator('.contact-row input').nth(1).fill('0901234567');
  await mini.locator('.guests-input input').fill('4');
  await mini.locator('.preview-picker-input[type=date]').fill(tomorrow);
  await mini.locator('.preview-picker-input[type=time]').fill('19:00');
  await mini.getByRole('button', { name: '提前选菜', exact: true }).click();
  await mini.waitForSelector('button.add,button.quantity-plus');
  await mini.locator('button.add,button.quantity-plus').first().click();
  await mini.locator('.cart-bar button:not(:disabled)').click();
  await mini.waitForSelector('button.submit');
  await mini.locator('button.submit').click();
  await mini.waitForSelector('.reservation-card');
  assert.equal(await mini.locator('.contact-row input').nth(0).inputValue(), '张先生');
  assert.equal(await mini.locator('.guests-input input').inputValue(), '4');
  assert(await mini.locator('.dish-row').count() > 0);
  await capture(mini, '04-miniapp-dine-in-preselected.png');
  await mini.getByRole('button', { name: '提交预约', exact: true }).click();
  await mini.waitForSelector('.reservation-status');
  assert.equal(await mini.locator('.status-label').innerText(), '待商家确认');
  const diningId = new URL(mini.url()).searchParams.get('id');
  report.flows.push({ name: 'dine-in preselection, preserved draft and submission', pass: true });
  await capture(mini, '05-miniapp-dining-pending.png');

  await mini.goto(miniUrl('merchant'));
  await mini.getByRole('button', { name: '预约到店', exact: true }).click();
  await mini.locator('.reservation-choice').filter({ hasText: '打包自取' }).click();
  await mini.waitForSelector('button.add,button.quantity-plus');
  await mini.locator('button.add,button.quantity-plus').first().click();
  await mini.locator('.cart-bar button:not(:disabled)').click();
  await mini.waitForSelector('button.submit'); await mini.locator('button.submit').click();
  await mini.waitForSelector('.reservation-card');
  await mini.getByRole('button', { name: '预约时间', exact: true }).click();
  await mini.locator('.preview-picker-input[type=date]').fill(tomorrow);
  await mini.locator('.preview-picker-input[type=time]').fill('18:30');
  await capture(mini, '06-miniapp-pickup-confirm.png');
  await mini.getByRole('button', { name: '提交预约', exact: true }).click();
  await mini.waitForSelector('.pickup-code');
  const pickupId = new URL(mini.url()).searchParams.get('id');
  assert((await mini.locator('.pickup-code').innerText()).trim().length > 0);
  await capture(mini, '07-miniapp-pickup-pending.png');
  report.flows.push({ name: 'scheduled pickup with code and pending confirmation', pass: true });

  const merchant = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await merchant.addInitScript(config => {
    localStorage.setItem('yunqiao_cashier_access_token', config.staffToken);
    localStorage.setItem('yunqiao_cashier_staff_session', JSON.stringify(config.staffSession));
    localStorage.setItem('yunqiao_cashier_locale', 'zh');
  }, config);
  const cashier = await merchant.newPage(); errorCollector(cashier);
  await cashier.goto('http://127.0.0.1:34122/reservations');
  await cashier.locator('.reservation-list-card').first().waitFor();
  await dismissInbox(cashier);
  await cashier.locator(`[data-reservation-key="DINE_IN:${diningId}"]`).click();
  await cashier.locator('.reservation-detail-panel').getByRole('button', { name: '确认预约', exact: true }).click();
  await cashier.locator('.reservation-detail-panel .status-badge').filter({ hasText: '预约已确认' }).waitFor();
  await cashier.getByRole('button', { name: '确认入座', exact: true }).click();
  await cashier.locator('.reservation-modal select option').nth(1).waitFor({ state: 'attached' });
  await cashier.locator('.reservation-modal select').selectOption({ index: 1 });
  await cashier.getByRole('button', { name: '确认操作', exact: true }).click();
  await cashier.locator('.reservation-detail-panel .status-badge').filter({ hasText: '已入座' }).waitFor();
  await capture(cashier, '08-cashier-dining-seated.png');
  await mini.goto(miniUrl('reservation', { id: diningId }));
  await mini.getByRole('button', { name: '继续点餐', exact: true }).waitFor();
  await capture(mini, '09-miniapp-dining-seated.png');
  report.flows.push({ name: 'merchant confirmation, seating and customer continuation', pass: true });

  await cashier.locator(`[data-reservation-key="PICKUP:${pickupId}"]`).click();
  await cashier.locator('.reservation-detail-panel').getByRole('button', { name: '确认预约', exact: true }).click();
  await cashier.locator('.reservation-detail-panel .status-badge').filter({ hasText: '预约已确认' }).waitFor();
  await cashier.getByRole('button', { name: '建议改约时间', exact: true }).click();
  await cashier.locator('.reservation-modal input[type=datetime-local]').fill(`${tomorrow}T20:30`);
  await cashier.getByRole('button', { name: '确认操作', exact: true }).click();
  await cashier.locator('.change-notice').waitFor();
  await mini.goto(miniUrl('order', { id: pickupId }));
  await mini.locator('.time-change').waitFor();
  await capture(mini, '10-miniapp-time-change-consent.png');
  await mini.getByRole('button', { name: '同意新时间', exact: true }).click();
  await mini.locator('.time-change').waitFor({ state: 'detached' });
  assert((await mini.locator('body').innerText()).includes('20:30'));
  await cashier.goto(`http://127.0.0.1:34122/pickup/${pickupId}`);
  await cashier.getByRole('button', { name: '开始制作', exact: true }).waitFor();
  report.flows.push({ name: 'rescheduling requires consent, then explicit preparation', pass: true });

  const recoveryContext = await browser.newContext({ viewport: { width:390, height:844 } });
  const recovery = await recoveryContext.newPage(); errorCollector(recovery);
  await recovery.goto(miniUrl('create', { kind:'DINE_IN' }));
  await recovery.locator('.reservation-card').first().waitFor();
  await recovery.locator('.contact-row input').nth(0).fill('网络重试验收');
  await recovery.locator('.contact-row input').nth(1).fill('0901234567');
  let committedReservationId;
  await recovery.route('**/api/v1/reservations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    assert(response.ok(), 'The original reservation committed before the connection failed');
    committedReservationId = (await response.json()).data.id;
    await route.abort('failed');
  });
  await recovery.getByRole('button', {name:'提交预约',exact:true}).click();
  await recovery.getByText('提交结果尚未确认，请重试提交，系统会核对原预约，避免重复创建。', {exact:true}).waitFor();
  await recovery.unroute('**/api/v1/reservations');
  await recovery.reload(); await recovery.locator('.reservation-card').first().waitFor();
  assert(await recovery.locator('.contact-row input').nth(0).isDisabled());
  await recovery.getByRole('button', {name:'提交预约',exact:true}).click();
  await recovery.locator('.reservation-status').waitFor();
  assert.equal(new URL(recovery.url()).searchParams.get('id'), committedReservationId);
  report.flows.push({name:'ambiguous network outcome recovers the original reservation after reopening',pass:true});
  await recoveryContext.close();

  }
  for (const [width, locale] of [[320, 'en'], [375, 'vi'], [390, 'zh']]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(); errorCollector(page);
    await page.goto(miniUrl('create', { kind: 'DINE_IN', width: String(width), locale }));
    await page.locator('.reservation-card').first().waitFor();
    await noOverflow(page, `miniapp-${width}-${locale}`);
    await capture(page, `11-miniapp-dine-in-${width}-${locale}.png`);
    await context.close();
  }
  for (const [width, locale] of [[1366, 'zh'], [1280, 'en'], [768, 'vi'], [375, 'vi']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ config, locale }) => {
      localStorage.setItem('yunqiao_cashier_access_token', config.staffToken);
      localStorage.setItem('yunqiao_cashier_staff_session', JSON.stringify(config.staffSession));
      localStorage.setItem('yunqiao_cashier_locale', locale);
    }, { config, locale });
    const page = await context.newPage(); errorCollector(page);
    await page.goto('http://127.0.0.1:34122/reservations');
    await page.locator('.reservation-list-card').first().waitFor();
    await dismissInbox(page);
    await noOverflow(page, `cashier-${width}-${locale}`);
    await capture(page, `12-cashier-reservations-${width}-${locale}.png`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  writeFileSync(resolve(output, 'browser-validation.json'), JSON.stringify({ ...report, pass: true }, null, 2));
  console.log(JSON.stringify({ flows: report.flows.length, layouts: report.layouts.length, errors: report.errors, pass: true }));
} finally { await browser.close(); }
