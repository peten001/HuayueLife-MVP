import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(new URL('../../merchant-cashier/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const base = process.env.BUSINESS_DAY_UI_URL || 'http://127.0.0.1:4198';
assert.equal(new URL(base).hostname, '127.0.0.1', 'local build only');
const output = process.env.BUSINESS_DAY_UI_OUTPUT || '/tmp/yunqiao-opening-day-ui-20260905';
await mkdir(output, { recursive: true });
const date = '2026-09-03';
const merchant = { id: '9000', nameZh: '隔离 UI 测试商家', status: 'ACTIVE', merchantMode: 'ORDER', capabilities: [{ code: 'onlineOrderEnabled', isEnabled: true }] };
const emptyBucket = { count: 0, amountVnd: '0' };
const funds = { grossAmountVnd: '500000', discountAmountVnd: '50000', roundingAmountVnd: '1000', netSettledAmountVnd: '449000', cashRevenueVnd: '449000', bankTransferRevenueVnd: '0', unrecordedRevenueVnd: '0' };
const summary = Object.fromEntries(['ALL', 'DINE_IN', 'PICKUP', 'DELIVERY', 'ABNORMAL', 'COMPLETED'].map(key => [key, { ...emptyBucket, ...funds, settlementCount: 0 }]));
summary.statusBreakdown = {};
const result = { source: 'Isolated mocked API, built local UI; not production or physical device', views: [], dateChecks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

function analytics(from = date, to = date) {
  return {
    generatedAt: '2026-09-03T18:00:00.000Z', currency: 'VND',
    period: { startDate: from, endDate: to, previousStartDate: '2026-09-02', previousEndDate: '2026-09-02', dayCount: 1, granularity: 'hour', timeZone: 'Asia/Ho_Chi_Minh' },
    overview: { revenueVnd: '449000', settlementCount: 1, averageOrderValueVnd: '449000', funds,
      previous: { revenueVnd: '0', settlementCount: 0, averageOrderValueVnd: '0' }, comparison: { revenuePercent: null, settlementCountPercent: null, averageOrderValuePercent: null }, topDish: null },
    trend: Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${hour}:00`, settlementCount: hour === 1 ? 1 : 0, revenueVnd: hour === 1 ? '449000' : '0' })),
    timeDistribution: Array.from({ length: 84 }, (_, i) => ({ weekday: Math.floor(i / 12), startHour: i % 12 * 2, endHour: i % 12 * 2 + 2, settlementCount: i === 36 ? 1 : 0, revenueVnd: i === 36 ? '449000' : '0' })),
    peakPeriod: { startHour: 0, endHour: 2, settlementCount: 1, revenueVnd: '449000' }, topDishes: [],
  };
}

async function open(locale, width, failDate = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  // Vietnam natural day is Sep 4, but the current store business day is Sep 3.
  await page.clock.setFixedTime('2026-09-03T18:00:00.000Z');
  await page.addInitScript(({ locale, merchant }) => {
    localStorage.setItem('huayue_merchant_token', 'isolated-ui-fixture');
    localStorage.setItem('huayue_merchant_locale', locale);
    localStorage.setItem('huayue_merchant_staff', JSON.stringify({ id: '9002', role: 'OWNER', mustChangePassword: false, merchant }));
  }, { locale, merchant });
  const calls = [];
  page.on('pageerror', error => result.errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes('/api/v1/')) return url.origin === base ? route.continue() : route.abort();
    assert.equal(request.method(), 'GET', 'this test must not submit any order mutation');
    const path = url.pathname.split('/api/v1')[1];
    calls.push({ path, params: Object.fromEntries(url.searchParams) });
    const respond = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    if (path === '/merchant/me') return respond({ user: { sub: '9002', role: 'OWNER', username: 'Fixture', merchantId: '9000', merchant, mustChangePassword: false } });
    if (path === '/merchant/analytics') return respond(analytics(url.searchParams.get('dateFrom') || date, url.searchParams.get('dateTo') || date));
    if (path === '/merchant/orders/business-day-summary') return failDate
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture business date unavailable' }) })
      : respond({ businessDate: date });
    if (path === '/merchant/orders/summary') return respond(summary);
    if (path === '/merchant/orders') return respond([]);
    if (path === '/merchant/settlements') return respond({ items: [], total: 0 });
    if (path === '/merchant/printing/feature-state') return respond({ legacyPrintingEnabled: false, merchantPrintingEnabled: false });
    return respond({});
  });
  return { context, page, calls };
}

try {
  for (const locale of ['zh', 'vi', 'en']) for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    const { context, page, calls } = await open(locale, width);
    await page.goto(`${base}/business-analytics`);
    await page.locator('.analytics-funds-heading span').waitFor();
    assert.deepEqual(calls.find(call => call.path === '/merchant/analytics').params, {});
    assert.match(await page.locator('.analytics-date-button').getAttribute('aria-label'), /9\/3/);
    for (const zoom of width === 1440 ? [1, 2] : [1]) {
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
      const measured = await page.evaluate(() => {
        const descriptions = [...document.querySelectorAll('.analytics-funds-heading span, .analytics-panel-heading p')]
          .filter(element => element.getClientRects().length);
        return { pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clippedDescriptions: descriptions.filter(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1).map(element => element.textContent),
          funds: document.querySelector('.analytics-funds-heading span').textContent };
      });
      result.views.push({ locale, width, zoom, ...measured });
      assert.ok(measured.pageOverflow <= 1, JSON.stringify({ locale, width, zoom, ...measured }));
      assert.deepEqual(measured.clippedDescriptions, []);
      await page.screenshot({ path: `${output}/${locale}-${width}-${zoom}x.png`, fullPage: true, animations: 'disabled' });
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    if (locale === 'zh' && width === 390) {
      await Promise.all([page.waitForResponse(response => response.url().includes('dateFrom=2026-08-28')), page.getByRole('button', { name: '近7天', exact: true }).click()]);
      assert.deepEqual(calls.filter(call => call.path === '/merchant/analytics').at(-1).params, { dateFrom: '2026-08-28', dateTo: date });
      await page.getByRole('button', { name: '自定义', exact: true }).click();
      await page.locator('input[type=date]').nth(0).fill('2026-09-01');
      await page.locator('input[type=date]').nth(1).fill('2026-09-01');
      await Promise.all([page.waitForResponse(response => response.url().includes('dateFrom=2026-09-01')), page.getByRole('button', { name: '应用日期', exact: true }).click()]);
      assert.deepEqual(calls.filter(call => call.path === '/merchant/analytics').at(-1).params, { dateFrom: '2026-09-01', dateTo: '2026-09-01' });
      await page.getByRole('button', { name: '今日', exact: true }).click();
      await page.locator('.analytics-funds-heading span').waitFor();
      assert.deepEqual(calls.filter(call => call.path === '/merchant/analytics').at(-1).params, {});
      result.dateChecks.push('Analytics: server opening-day default, 7-day anchor, custom date, Today reset');
    }
    await Promise.all([page.waitForResponse(response => response.url().includes('/merchant/orders/summary')), page.goto(`${base}/orders`)]);
    const dated = calls.filter(call => ['/merchant/orders', '/merchant/orders/summary'].includes(call.path));
    assert.ok(dated.length >= 2);
    assert.ok(dated.every(call => call.params.date === date), 'order list and summaries use server current business day');
    assert.equal(await page.locator('.orders-desktop-view input[type=date]').inputValue(), date);
    await context.close();
  }
  const { context, page, calls } = await open('zh', 390, true);
  await page.goto(`${base}/orders`);
  await page.getByText('Fixture business date unavailable', { exact: true }).filter({ visible: true }).waitFor();
  assert.equal(calls.filter(call => ['/merchant/orders', '/merchant/orders/summary'].includes(call.path)).length, 0, 'failed day lookup must not fetch guessed natural-day totals');
  result.dateChecks.push('Orders: midnight default aligned in all 18 cases; day lookup failure visible and no guessed-date requests');
  await context.close();
  assert.deepEqual(result.errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(`PASS ${result.views.length} localized viewport/zoom checks; date behavior checks; ${output}`);
} finally { await browser.close(); }
