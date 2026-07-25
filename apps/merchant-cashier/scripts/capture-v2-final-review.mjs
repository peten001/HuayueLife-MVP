import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const verifyOnly = process.argv.includes('--verify-only');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, '../../../docs/ui-review/merchant-cashier-v2-final');
const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const browserChannel = process.env.CASHIER_BROWSER_CHANNEL || 'chrome';
const browserErrors = [];
const captureNames = new Set();
let screenshotWrites = 0;

const viewports = {
  pc: { width: 1920, height: 1080 },
  d10: { width: 1280, height: 800 },
  tablet: { width: 1024, height: 768 },
  phone: { width: 390, height: 844 },
};

const androidWebViewUserAgent = [
  'Mozilla/5.0 (Linux; Android 11; D10 Build/RQ3A.210905.001; wv)',
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0',
  'Chrome/120.0.0.0 Mobile Safari/537.36 YunqiaoCashier/2.0',
].join(' ');

if (!verifyOnly) await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel === 'bundled' ? undefined : browserChannel,
  headless: true,
});

try {
  await verifyPcTables();
  await verifyD10Tables();
  await verifyPcPickup();
  await verifyD10Pickup();
  await verifyPcDelivery();
  await verifyD10Delivery();
  await verifyTabletPickup();
  await verifyTabletDelivery();
  await verifyPhonePickup();
  await verifyPhoneDelivery();
  await verifyOrderHistory();
  await verifyAndroidWebView();

  assert.equal(captureNames.size, 13, 'V2 final review must define exactly 13 screenshot scenes');
  assert.equal(
    screenshotWrites,
    verifyOnly ? 0 : 13,
    verifyOnly
      ? '--verify-only must not write screenshots'
      : 'V2 final review must write exactly 13 screenshots',
  );
  assert.equal(
    browserErrors.length,
    0,
    `browser console/page errors:\n${browserErrors.join('\n')}`,
  );

  process.stdout.write(
    verifyOnly
      ? 'Verified cashier V2 final workflow, routing, chat, and all four responsive targets without writing screenshots.\n'
      : `Captured and verified 13 cashier V2 final screenshots in ${outputDirectory}\n`,
  );
} finally {
  await browser.close();
}

async function verifyPcTables() {
  await withDemo('pc-tables', viewports.pc, async (page) => {
    await assertTopReminderRouting(page);
    await assertLegacyDeliveryRouting(page);

    await spaNavigate(page, '/tables');
    await page.getByTestId('table-grid').waitFor();
    await page.getByTestId('table-card-demo-table-2').click();
    await waitForPath(page, '/tables/demo-table-2');
    await page.getByTestId('table-detail').waitFor();

    const emptyTableEntry = page.getByTestId('table-order-items');
    await emptyTableEntry.waitFor();
    assert.equal(await emptyTableEntry.isEnabled(), true, 'an empty table must expose an enabled open-table ordering entry');
    assert.match(
      (await emptyTableEntry.textContent()) || '',
      /开台.*点菜|点菜.*开台/,
      'the empty-table entry must clearly say open table and order',
    );

    await spaNavigate(page, '/tables/demo-table-1?order=demo-order-1001');
    await page.getByTestId('table-detail').waitFor();
    await assertDineInLayout(page, 'pc');
    await assertDineInPendingState(page);
    await assertDineInOrderingAndAdjustments(page);
    await selectDineInOrder(page, 'DEMO-1001');
    await assertDineInPendingState(page);

    await capture(page, '01-pc-1920x1080-tables.png');
    await assertDineInAcceptCheckoutAndRelease(page);
  });
}

async function verifyD10Tables() {
  await withDemo('d10-tables', viewports.d10, async (page) => {
    await openInboxOrder(page, 'DEMO-1001');
    await waitForPath(page, '/tables/demo-table-1');
    await page.getByTestId('table-detail').waitFor();
    await assertDineInLayout(page, 'd10');
    await assertDineInPendingState(page);
    await assertDockAtWorkspaceBottom(page, '.table-route-detail', '[data-testid="dinein-action-dock"]');
    await capture(page, '02-d10-1280x800-tables.png');
  });
}

async function verifyPcPickup() {
  await withDemo('pc-pickup', viewports.pc, async (page) => {
    await openFulfillmentOrder(page, 'pickup', 'demo-order-1004');
    await assertFulfillmentTwoColumn(page, 'pc');
    await assertPickupContent(page, 'demo-order-1004');
    await capture(page, '03-pc-1920x1080-pickup.png');
    await assertPrintRemainsPresent(page);
    await assertFulfillmentAcceptStartsPreparing(page);
  });
}

async function verifyD10Pickup() {
  await withDemo('d10-pickup', viewports.d10, async (page) => {
    await openFulfillmentOrder(page, 'pickup', 'demo-order-1004');
    await assertFulfillmentTwoColumn(page, 'd10');
    await assertPickupContent(page, 'demo-order-1004');
    await assertDockAtWorkspaceBottom(page, '.fulfillment-main', '.fulfillment-action-dock');
    await capture(page, '04-d10-1280x800-pickup.png');
  });
}

async function verifyPcDelivery() {
  await withDemo('pc-delivery', viewports.pc, async (page) => {
    await openFulfillmentOrder(page, 'delivery', 'demo-order-1005');
    await assertFulfillmentTwoColumn(page, 'pc');
    await assertDeliveryContent(page, 'demo-order-1005');
    await capture(page, '05-pc-1920x1080-delivery.png');
    await assertDeliveryCopy(page);
    await assertPrintRemainsPresent(page);
  });
}

async function verifyD10Delivery() {
  await withDemo('d10-delivery', viewports.d10, async (page) => {
    await openFulfillmentOrder(page, 'delivery', 'demo-order-1005');
    await assertFulfillmentTwoColumn(page, 'd10');
    await assertDeliveryContent(page, 'demo-order-1005');
    await assertDockAtWorkspaceBottom(page, '.fulfillment-main', '.fulfillment-action-dock');
    await capture(page, '06-d10-1280x800-delivery.png');
    await assertDeliveryCopy(page);
  });
}

async function verifyTabletPickup() {
  await withDemo('tablet-pickup', viewports.tablet, async (page) => {
    await openFulfillmentOrder(page, 'pickup', 'demo-order-1004');
    await assertFulfillmentTwoColumn(page, 'tablet');
    await assertPickupContent(page, 'demo-order-1004');
    await capture(page, '07-tablet-1024x768-pickup.png');
    await assertChatUnreadReadAndIsolation(page);
  });
}

async function verifyTabletDelivery() {
  await withDemo('tablet-delivery', viewports.tablet, async (page) => {
    await openFulfillmentOrder(page, 'delivery', 'demo-order-1005');
    await assertFulfillmentTwoColumn(page, 'tablet');
    await assertDeliveryContent(page, 'demo-order-1005');
    await capture(page, '08-tablet-1024x768-delivery.png');
    await assertDeliveryCopy(page);
  });
}

async function verifyPhonePickup() {
  await withDemo('phone-pickup', viewports.phone, async (page) => {
    await openSection(page, '/pickup');
    const card = page.getByTestId('pickup-order-demo-order-1004');
    await card.waitFor();
    await assertPhoneListState(page, card);
    await capture(page, '09-phone-390x844-pickup-list.png');

    const search = page.locator('.workflow-search input');
    await search.fill('DEMO-1004');
    assert.equal(await unreadBadge(card).count(), 1, 'pickup unread summary must start visible');
    await card.click();
    await waitForPath(page, '/pickup/demo-order-1004');
    await page.locator('.pickup-order-detail').waitFor();
    await assertPhoneDetailState(page);
    assert.equal(
      await unreadBadge(card).count(),
      1,
      'opening pickup detail without opening chat must not clear unread',
    );

    await openChatPane(page);
    await waitForUnreadToClear(page, 'pickup-order-demo-order-1004');
    await assertPhoneChatSafeArea(page);
    await capture(page, '10-phone-390x844-pickup-detail-chat.png');

    await page.locator('.mobile-workspace-back:visible').click();
    await waitForPath(page, '/pickup');
    assert.equal(await search.inputValue(), 'DEMO-1004', 'mobile back must preserve pickup list search state');
  });
}

async function verifyPhoneDelivery() {
  await withDemo('phone-delivery', viewports.phone, async (page) => {
    await openSection(page, '/delivery');
    const card = page.getByTestId('delivery-order-demo-order-1005');
    await card.waitFor();
    await assertPhoneListState(page, card);
    await capture(page, '11-phone-390x844-delivery-list.png');

    await card.click();
    await waitForPath(page, '/delivery/demo-order-1005');
    await page.locator('.delivery-order-detail').waitFor();
    await assertPhoneDetailState(page);
    await assertDeliveryContent(page, 'demo-order-1005');
    await assertDeliveryCopy(page, { touchTarget: true });
    await dismissToasts(page);

    await openChatPane(page);
    await waitForUnreadToClear(page, 'delivery-order-demo-order-1005');
    const compactContact = page.getByTestId('delivery-side-info');
    await compactContact.waitFor();
    assert.match((await compactContact.textContent()) || '', /Demo address \(not real\)/);
    assert.match((await compactContact.textContent()) || '', /000-000-000/);
    assert.match((await compactContact.textContent()) || '', /Demo data/);
    await assertDeliveryCopy(page, { touchTarget: true, exercise: false });
    await page.locator('[data-testid="copy-delivery-address"]:visible').click();
    await assertClipboardValue(page, 'Demo address (not real)');
    await assertPhoneChatSafeArea(page);
    await capture(page, '12-phone-390x844-delivery-detail-copy-chat.png');
  });
}

async function verifyOrderHistory() {
  await withDemo('pc-history', viewports.pc, async (page) => {
    await openSection(page, '/orders/history');
    const firstHistoryOrder = page.locator('.history-queue__list button').first();
    await firstHistoryOrder.waitFor();
    await firstHistoryOrder.click();
    await page.locator('.history-detail__content').waitFor();
    await assertHistoryTwoColumn(page);
    assert.equal(await page.getByTestId('print-primary').count(), 1, 'history detail must retain print');
    assert.equal(await page.locator('.fulfillment-action-dock, [data-testid="dinein-action-dock"]').count(), 0, 'history must be read-only');
    assert.equal(await page.locator('.order-chat-workspace').count(), 0, 'history must not render live chat');
    await capture(page, '13-pc-1920x1080-order-history.png');
  });
}

async function verifyAndroidWebView() {
  await withDemo(
    'android-webview-d10',
    viewports.d10,
    async (page) => {
      await openInboxOrder(page, 'DEMO-1001');
      await waitForPath(page, '/tables/demo-table-1');
      await page.getByTestId('table-grid').waitFor();
      await page.getByTestId('dinein-action-dock').waitFor();
      await assertGridColumns(page, 4, 'Android WebView D10 table grid');
      await assertNoHorizontalOverflow(page, 'Android WebView D10');
      assert.match(
        await page.evaluate(() => navigator.userAgent),
        /; wv\)|YunqiaoCashier\/2\.0/,
        'Android compatibility check must use a WebView user agent',
      );
    },
    { userAgent: androidWebViewUserAgent },
  );
}

async function withDemo(label, viewport, run, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`${label} page: ${error.message}`));

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    const demo = page.getByTestId('enter-demo');
    assert.equal(
      await demo.isVisible(),
      true,
      'start Vite with VITE_CASHIER_USE_FIXTURES=true before running the V2 review',
    );
    await demo.click();
    await waitForPath(page, '/tables');
    await page.getByTestId('table-grid').waitFor();
    await settle(page);
    await run(page);
    await assertNoHorizontalOverflow(page, label);
  } finally {
    await context.close();
  }
}

async function assertTopReminderRouting(page) {
  await openInboxOrder(page, 'DEMO-1001');
  await waitForPath(page, '/tables/demo-table-1');
  let url = new URL(page.url());
  assert.equal(url.searchParams.get('order'), 'demo-order-1001', 'dine-in reminder must select the matching order');
  await page.getByTestId('table-card-demo-table-1').waitFor();
  assert.match(
    (await page.getByTestId('table-card-demo-table-1').textContent()) || '',
    /A01/,
    'dine-in reminder must select the matching table',
  );

  await openInboxOrder(page, 'DEMO-1004');
  await waitForPath(page, '/pickup/demo-order-1004');
  assert.equal(new URL(page.url()).pathname, '/pickup/demo-order-1004');

  await openInboxOrder(page, 'DEMO-1005');
  await waitForPath(page, '/delivery/demo-order-1005');
  assert.equal(new URL(page.url()).pathname, '/delivery/demo-order-1005');
}

async function assertLegacyDeliveryRouting(page) {
  await spaNavigate(page, '/orders/new?order=demo-order-1005');
  await waitForPath(page, '/delivery/demo-order-1005');
  assert.notEqual(new URL(page.url()).pathname, '/pickup/demo-order-1005', 'legacy new delivery must never fall into pickup');

  await spaNavigate(page, '/orders/active?order=demo-order-1003');
  await waitForPath(page, '/delivery/demo-order-1003');
  assert.notEqual(new URL(page.url()).pathname, '/pickup/demo-order-1003', 'legacy active delivery must never fall into pickup');
}

async function assertDineInLayout(page, target) {
  assert.equal(await page.locator('.dinein-table-board').count(), 0, 'the temporary redesigned table board must be removed');
  assert.equal(await page.locator('.dinein-order-queue').count(), 0, 'dine-in must not insert an order-list column between grid and detail');
  assert.equal(await page.locator('.cashier-shell__detail').count(), 0, 'the legacy global detail drawer must stay removed');
  assert.equal(await page.locator('.order-chat-workspace').count(), 0, 'dine-in must never render chat');
  await assertGridColumns(page, 4, `${target} table grid`);

  const sidebar = await requiredBox(page.locator('.cashier-sidebar:visible'), `${target} sidebar`);
  const detail = await requiredBox(page.getByTestId('table-route-detail'), `${target} table detail column`);
  const viewport = page.viewportSize();
  assert.ok(viewport, `${target} viewport must exist`);
  const sidebarRatio = sidebar.width / viewport.width;
  const detailRatio = detail.width / viewport.width;

  if (target === 'pc') {
    assert.ok(sidebarRatio >= 0.105 && sidebarRatio <= 0.13, `PC sidebar must preserve old width ratio, got ${sidebarRatio.toFixed(3)}`);
    assert.ok(detailRatio >= 0.16 && detailRatio <= 0.205, `PC detail must preserve old width ratio, got ${detailRatio.toFixed(3)}`);
  } else {
    assert.ok(sidebarRatio >= 0.135 && sidebarRatio <= 0.16, `D10 sidebar must preserve old width ratio, got ${sidebarRatio.toFixed(3)}`);
    assert.ok(detailRatio >= 0.205 && detailRatio <= 0.25, `D10 detail must preserve old width ratio, got ${detailRatio.toFixed(3)}`);
  }
}

async function assertGridColumns(page, expected, label) {
  const columns = await page.getByTestId('table-grid').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
  );
  assert.equal(columns, expected, `${label} must preserve the old ${expected}-column grid`);
}

async function assertDineInPendingState(page) {
  const dock = page.getByTestId('dinein-action-dock');
  await dock.waitFor();
  const settlement = page.getByTestId('table-settlement-summary');
  assert.match((await settlement.textContent()) || '', /513,000/, 'dine-in settlement must expose the original 513,000 VND amount');
  assert.match((await page.getByTestId('table-rounding-rule').textContent()) || '', /10,000/, 'dine-in settlement must state the 10,000 VND rounding rule');
  const print = page.getByTestId('print-primary');
  const accept = page.getByTestId('dinein-accept');
  const checkout = page.getByTestId('dinein-checkout');
  assert.equal(await print.isVisible(), true, 'dine-in print must always be visible');
  assert.equal(await accept.isEnabled(), true, 'pending dine-in order must be acceptable');
  assert.equal(await checkout.isDisabled(), true, 'dine-in checkout must be blocked before acceptance');
  assert.equal(
    await page.getByRole('button', { name: /开始制作|制作完成|完成订单|关闭桌账/ }).count(),
    0,
    'dine-in must not expose preparation, complete-order, or close-session workflow buttons',
  );
}

async function assertDineInOrderingAndAdjustments(page) {
  const addItems = page.getByTestId('table-order-items');
  await addItems.waitFor();
  assert.equal(await addItems.isEnabled(), true, 'an occupied table must keep the add-items entry');
  assert.match((await addItems.textContent()) || '', /加菜|点菜/, 'occupied table must retain add-item ordering');

  await page.getByTestId('table-orders-tab').click();
  await selectDineInOrder(page, 'DEMO-1001');
  assert.ok(await page.getByTestId('decrease-order-item').count(), 'pending QR order must retain decrease-item controls');

  await selectDineInOrder(page, 'DEMO-1006');
  assert.ok(await page.getByTestId('return-order-item').count(), 'accepted dine-in order must retain return-item controls');
}

async function selectDineInOrder(page, orderNo) {
  const row = page.locator('.bill-order-row').filter({ hasText: orderNo }).first();
  await row.waitFor();
  await row.click();
  const selected = page.getByTestId('table-selected-order');
  await selected.waitFor();
  assert.match((await selected.textContent()) || '', new RegExp(orderNo));
}

async function assertDineInAcceptCheckoutAndRelease(page) {
  const print = page.getByTestId('print-primary');
  assert.equal(await print.isVisible(), true, 'print must be present before acceptance');

  await page.getByTestId('dinein-accept').click();
  await page.getByTestId('table-rounding').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="table-settlement-summary"]')?.textContent || '';
    return /513,000[\s\S]*3,000[\s\S]*510,000/.test(text);
  });
  assert.match((await page.locator('.table-bill-total-row').textContent()) || '', /510,000/);
  await page.getByTestId('table-rounding').click();
  const checkout = page.getByTestId('dinein-checkout');
  await waitForEnabled(checkout);
  assert.equal(await checkout.isEnabled(), true, 'accepted table must be immediately checkout-ready');
  assert.equal(await print.isVisible(), true, 'print must remain present after acceptance');

  await checkout.click();
  const confirm = page.locator('.confirm-dialog');
  await confirm.waitFor();
  assert.match(
    (await confirm.textContent()) || '',
    /不代表.*支付|不代表.*收款/,
    'checkout confirmation must not imply payment or settlement',
  );
  await confirm.locator('.primary-action').click();
  await waitForPath(page, '/tables');
  const table = page.getByTestId('table-card-demo-table-1');
  await table.waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="table-card-demo-table-1"]')?.getAttribute('data-status') === 'AVAILABLE',
  );
  assert.equal(await table.getAttribute('data-status'), 'AVAILABLE', 'checkout must release the table automatically');
}

async function assertFulfillmentTwoColumn(page, target) {
  assert.equal(await page.locator('.fulfillment-side').count(), 0, 'fulfillment must not render a third side column');
  const workspace = await requiredBox(page.locator('.fulfillment-workspace'), `${target} fulfillment workspace`);
  const queue = await requiredBox(page.locator('.fulfillment-queue'), `${target} fulfillment queue`);
  const main = await requiredBox(page.locator('.fulfillment-main'), `${target} fulfillment detail`);
  const visibleDirectChildren = await page.locator('.fulfillment-workspace > *').evaluateAll((elements) =>
    elements.filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }).length,
  );
  assert.equal(visibleDirectChildren, 2, `${target} fulfillment workspace must contain exactly queue and detail`);
  assert.ok(queue.x + queue.width <= main.x + 2, `${target} fulfillment columns must not overlap`);
  const trailingGap = workspace.x + workspace.width - (main.x + main.width);
  assert.ok(trailingGap <= 16, `${target} detail must consume the remaining width without a blank third column (gap ${trailingGap.toFixed(1)}px)`);
  const queueRatio = queue.width / (queue.width + main.width);

  if (target === 'pc') {
    assert.ok(queueRatio >= 0.27 && queueRatio <= 0.33, `PC fulfillment queue must be approximately 30%, got ${queueRatio.toFixed(3)}`);
  } else if (target === 'd10') {
    assert.ok(queue.width >= 280 && queue.width <= 320, `D10 fulfillment queue must be about 300px, got ${queue.width.toFixed(1)}px`);
  } else {
    assert.ok(queueRatio >= 0.27 && queueRatio <= 0.40, `tablet fulfillment queue/detail must remain a useful two-column split, got ${queueRatio.toFixed(3)}`);
  }
}

async function assertPickupContent(page, orderId) {
  const card = page.getByTestId(`pickup-order-${orderId}`);
  const detail = page.locator('.pickup-order-detail');
  await detail.waitFor();
  const cardText = (await card.textContent()) || '';
  const detailText = (await detail.textContent()) || '';
  assert.match(cardText, /1004/);
  assert.match(cardText, /Demo Customer/);
  assert.match(cardText, /\*{2,}/, 'pickup list phone must be masked');
  assert.match(cardText, /VND/);
  assert.match(detailText, /取餐码/);
  assert.match(detailText, /预计取餐|预计完成/);
  assert.match(detailText, /等待/);
  assert.match(detailText, /顾客信息/);
  assert.match(detailText, /演示菜品/);
  assert.match(detailText, /打包费/);
  assert.equal(await page.getByTestId('print-primary').count(), 1, 'pickup action dock must keep print');
}

async function assertFulfillmentAcceptStartsPreparing(page) {
  const accept = page.getByRole('button', { name: '接单', exact: true });
  assert.equal(await accept.count(), 1, 'pending fulfillment order must expose one accept action');
  await accept.click();
  const finishPreparing = page.getByRole('button', { name: '制作完成', exact: true });
  await finishPreparing.waitFor();
  assert.equal(
    await page.getByRole('button', { name: '开始制作', exact: true }).count(),
    0,
    'accept must enter preparation without a second cashier start action',
  );
}

async function assertDeliveryContent(page, orderId) {
  const card = page.getByTestId(`delivery-order-${orderId}`);
  const detail = page.locator('.delivery-order-detail');
  await detail.waitFor();
  const cardText = (await card.textContent()) || '';
  const detailText = (await detail.textContent()) || '';
  assert.match(cardText, /Demo address \(not real\)/);
  assert.match(cardText, /Demo Customer/);
  assert.match(cardText, /\*{2,}/, 'delivery list phone must be masked');
  assert.match(cardText, /Demo data/);
  assert.match(cardText, /VND/);
  assert.match(detailText, /Demo address \(not real\)/);
  assert.match(detailText, /000-000-000/);
  assert.match(detailText, /Demo data/);
  assert.match(detailText, /演示菜品/);
  assert.match(detailText, /等待/);
  assert.match(detailText, /打包费/);
  assert.match(detailText, /配送费/);
  assert.equal(await page.getByTestId('print-primary').count(), 1, 'delivery action dock must keep print');
  await assertDeliveryHasNoMapOrNavigation(page);
}

async function assertDeliveryHasNoMapOrNavigation(page) {
  assert.equal(
    await page.locator([
      '.fulfillment-main iframe',
      '.fulfillment-main [data-map]',
      '.fulfillment-main [data-testid*="map"]',
      '.fulfillment-main [class*="route-map"]',
      '.fulfillment-main [class*="delivery-map"]',
      '.fulfillment-main [class*="route-plan"]',
      '.fulfillment-main a[href*="maps"]',
      '.fulfillment-main a[href^="geo:"]',
    ].join(', ')).count(),
    0,
    'delivery must not render maps, route planning, or map links',
  );
  assert.equal(
    await page.locator('.fulfillment-main').getByRole('button', { name: /地图|导航|路线规划|map|navigate|route planning/i }).count(),
    0,
    'delivery must not render navigation controls',
  );
}

async function assertDeliveryCopy(page, options = {}) {
  const address = page.locator('[data-testid="copy-delivery-address"]:visible');
  const phone = page.locator('[data-testid="copy-delivery-phone"]:visible');
  await address.waitFor();
  await phone.waitFor();
  assert.equal(await address.isVisible(), true, 'delivery must expose copy address');
  assert.equal(await phone.isVisible(), true, 'delivery must expose copy phone');
  if (options.touchTarget) {
    const addressBox = await requiredBox(address, 'copy-address button');
    const phoneBox = await requiredBox(phone, 'copy-phone button');
    assert.ok(addressBox.height >= 44, `copy-address touch target must be at least 44px, got ${addressBox.height}px`);
    assert.ok(phoneBox.height >= 44, `copy-phone touch target must be at least 44px, got ${phoneBox.height}px`);
  }
  if (options.exercise === false) return;
  await address.click();
  await assertClipboardValue(page, 'Demo address (not real)');
  await phone.click();
  await assertClipboardValue(page, '000-000-000');
}

async function dismissToasts(page) {
  const dismissButtons = page.locator('.cashier-toast button');
  while (await dismissButtons.count()) await dismissButtons.first().click();
}

async function assertClipboardValue(page, expected) {
  const clipboard = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  });
  assert.equal(clipboard, expected, `clipboard must contain ${expected}`);
}

async function assertPrintRemainsPresent(page) {
  const print = page.getByTestId('print-primary');
  await print.waitFor();
  assert.equal(await print.isVisible(), true, 'print/reprint entry must remain visible for the selected order');
  assert.equal(await print.count(), 1, 'selected order must expose exactly one persistent print entry');
}

async function assertChatUnreadReadAndIsolation(page) {
  const firstCard = page.getByTestId('pickup-order-demo-order-1004');
  assert.equal(await unreadBadge(firstCard).count(), 1, 'selecting detail must not clear unread before chat opens');
  await openChatPane(page);
  await waitForUnreadToClear(page, 'pickup-order-demo-order-1004');
  const firstComposer = page.locator('.chat-composer__input');
  await waitForEnabled(firstComposer);
  await firstComposer.fill('V2-DRAFT-A');

  await page.getByTestId('pickup-order-demo-order-1002').click();
  await waitForPath(page, '/pickup/demo-order-1002');
  await openChatPane(page);
  const secondComposer = page.locator('.chat-composer__input');
  await waitForEnabled(secondComposer);
  assert.equal(await secondComposer.inputValue(), '', 'chat draft must reset when switching orders');
  await secondComposer.fill('V2 order B message');
  await page.locator('.chat-composer__send').click();
  await page.getByText('V2 order B message', { exact: true }).waitFor();

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByText('V2 order B message', { exact: true }).count(),
    1,
    'chat polling refresh must retain the current order message exactly once',
  );

  await page.getByTestId('pickup-order-demo-order-1004').click();
  await waitForPath(page, '/pickup/demo-order-1004');
  await openChatPane(page);
  assert.equal(
    await page.getByText('V2 order B message', { exact: true }).count(),
    0,
    'chat messages must never leak across orders',
  );
}

async function openChatPane(page) {
  const tabs = page.locator('.fulfillment-pane-tabs:visible');
  await tabs.waitFor();
  await tabs.locator('button').last().click();
  await page.getByTestId('order-chat-workspace').waitFor();
  await waitForEnabled(page.locator('.chat-composer__input'));
}

async function waitForUnreadToClear(page, cardTestId) {
  await page.waitForFunction((testId) =>
    !document.querySelector(`[data-testid="${testId}"] .order-unread-badge`), cardTestId);
}

function unreadBadge(card) {
  return card.locator('.order-unread-badge');
}

async function assertPhoneListState(page, card) {
  assert.equal(await page.locator('.fulfillment-queue').isVisible(), true, 'phone list route must show the order queue');
  assert.equal(await page.locator('.fulfillment-main').isVisible(), false, 'phone list route must not show detail beside the queue');
  assert.equal(await card.isVisible(), true, 'phone list must show the requested order card');
  await assertMobileNavigation(page);
}

async function assertPhoneDetailState(page) {
  assert.equal(await page.locator('.fulfillment-queue').isVisible(), false, 'phone detail route must hide the list pane');
  assert.equal(await page.locator('.fulfillment-main').isVisible(), true, 'phone detail route must show its own workspace');
  assert.equal(await page.locator('.mobile-workspace-back:visible').count(), 1, 'phone detail must expose back-to-list');
  await assertMobileNavigation(page);
}

async function assertMobileNavigation(page) {
  const navigation = page.locator('.cashier-mobile-navigation:visible');
  await navigation.waitFor();
  assert.equal(await navigation.locator('a').count(), 4, 'phone bottom navigation must contain tables, pickup, delivery, and history only');
}

async function assertPhoneChatSafeArea(page) {
  const send = page.locator('.chat-composer__send');
  const composer = page.locator('.chat-composer__input');
  const navigation = page.locator('.cashier-mobile-navigation:visible');
  const sendBox = await requiredBox(send, 'phone chat send');
  const composerBox = await requiredBox(composer, 'phone chat composer');
  const navigationBox = await requiredBox(navigation, 'phone bottom navigation');
  assert.ok(composerBox.height >= 44, `phone chat composer must meet 44px touch height, got ${composerBox.height}px`);
  assert.ok(sendBox.height >= 44, `phone chat send must meet 44px touch height, got ${sendBox.height}px`);
  assert.ok(composerBox.y >= 0, 'phone chat composer must remain inside the viewport');
  assert.ok(sendBox.y + sendBox.height <= navigationBox.y + 1, 'phone chat controls must stay above bottom navigation');
}

async function assertHistoryTwoColumn(page) {
  const workspace = await requiredBox(page.locator('.history-workspace'), 'history workspace');
  const queue = await requiredBox(page.locator('.history-queue'), 'history queue');
  const detail = await requiredBox(page.locator('.history-detail'), 'history detail');
  assert.ok(queue.x + queue.width <= detail.x + 2, 'history queue and detail must not overlap');
  assert.ok(detail.x + detail.width >= workspace.x + workspace.width - 16, 'history detail must fill remaining width');
  const queueRatio = queue.width / (queue.width + detail.width);
  assert.ok(queueRatio >= 0.20 && queueRatio <= 0.30, `history must preserve a compact queue/detail split, got ${queueRatio.toFixed(3)}`);
}

async function assertDockAtWorkspaceBottom(page, workspaceSelector, dockSelector) {
  const workspace = await requiredBox(page.locator(workspaceSelector), `${workspaceSelector} workspace`);
  const dock = await requiredBox(page.locator(dockSelector), `${dockSelector} dock`);
  assert.ok(
    workspace.y + workspace.height - (dock.y + dock.height) <= 16,
    `${dockSelector} must stay fixed to the bottom of its workspace (gap ${(
      workspace.y + workspace.height - (dock.y + dock.height)
    ).toFixed(1)}px)`,
  );
}

async function openInboxOrder(page, orderNo) {
  await page.getByTestId('top-new-orders').click();
  const inbox = page.getByTestId('new-order-inbox');
  await inbox.waitFor();
  const text = (await inbox.textContent()) || '';
  assert.match(text, /堂食/);
  assert.match(text, /到店自取/);
  assert.match(text, /商家配送/);
  const order = inbox.locator('button').filter({ hasText: `#${orderNo}` }).first();
  await order.waitFor();
  await order.click();
}

async function openFulfillmentOrder(page, type, id) {
  const root = type === 'pickup' ? '/pickup' : '/delivery';
  await openSection(page, root);
  const card = page.getByTestId(`${type}-order-${id}`);
  await card.waitFor();
  await card.click();
  await waitForPath(page, `${root}/${id}`);
  await page.locator(`.${type}-order-detail`).waitFor();
}

async function openSection(page, path) {
  const link = page.locator(`a[href="${path}"]:visible`).first();
  await link.waitFor();
  await link.click();
  await waitForPath(page, path);
}

async function spaNavigate(page, path) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function waitForPath(page, expectedPath) {
  await page.waitForURL((url) => url.pathname === expectedPath);
}

async function waitForEnabled(locator) {
  await locator.waitFor();
  await locator.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    if (!element.disabled) return;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        rejectPromise(new Error('control did not become enabled'));
      }, 15_000);
      const observer = new MutationObserver(() => {
        if (!element.disabled) {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolvePromise(undefined);
        }
      });
      observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
    });
  });
}

async function requiredBox(locator, label) {
  await locator.waitFor();
  const box = await locator.boundingBox();
  assert.ok(box, `${label} must be visible and measurable`);
  return box;
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth,
  ));
  assert.ok(overflow <= 1, `${label} has horizontal overflow: ${overflow}px`);
}

async function capture(page, fileName) {
  assert.equal(captureNames.has(fileName), false, `duplicate screenshot scene: ${fileName}`);
  captureNames.add(fileName);
  await settle(page);
  await assertNoHorizontalOverflow(page, fileName);
  if (verifyOnly) return;
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    fullPage: false,
    animations: 'disabled',
  });
  screenshotWrites += 1;
}
