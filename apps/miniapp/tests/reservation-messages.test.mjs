import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../src');
function harness(kind = 'messages') {
  const hooks = {}, calls = [], locale = vue.ref('zh');
  const auth = vue.reactive({ user: { id: '2' }, restoreSession: async () => {}, ensureLogin: async () => {} });
  const order = { id: '31', orderNo: 'HY31', orderType: 'PICKUP', isReservation: true, status: 'ACCEPTED', createdAt: '2026-10-20T08:00:00Z', scheduledFor: '2026-10-21T08:00:00Z', merchant: { id: '3', nameZh: '华越餐厅' }, items: [] };
  const booking = { id: '31', reservationNo: 'YY31', status: 'CONFIRMED', createdAt: '2026-10-20T07:00:00Z', scheduledFor: '2026-10-21T09:00:00Z', merchant: order.merchant, items: [], chatConversation: { id: 'chat-r', status: 'ACTIVE', customerUnreadCount: 1, merchantUnreadCount: 0, lastMessageAt: '2026-10-20T09:00:00Z' } };
  let orderResponse = async () => [order], reservationResponse = async () => [booking];
  const mocks = {
    vue,
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onUnload'].map(key => [key, fn => { hooks[key] = fn; }])),
    '@/stores/auth': { useAuthStore: () => auth },
    '@/i18n': { locale, useI18n: () => ({ t: key => key, locale }), usePageTitle: () => {}, translateApiError: value => value,
      orderMerchantName: row => row.merchant.nameZh, orderStatusLabel: value => value, orderTypeLabel: value => value,
      productSnapshotName: item => item.productNameZhSnapshot },
    '@/utils/order-chat-media': { chatMediaLabel: (_locale, key) => key },
    '@/api/orders': { getOrders: () => orderResponse() },
    '@/api/reservations': { getDiningReservations: () => reservationResponse() },
    './http': { request: (url, options) => { calls.push([url, options]); return Promise.resolve({}); }, API_BASE_URL: '/api/v1' },
    '@/utils/storage': { getToken: () => 'local-test-token' },
  };
  const cache = new Map();
  const uni = { navigateTo: options => calls.push(['navigate', options.url]), showToast: () => {},
    uploadFile: options => { calls.push(['upload', options.url]); options.success({ statusCode: 201, data: JSON.stringify({ data: { id: 'image' } }) }); } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] + '\nexport { merchantRecords, merchantMessage, loadMerchantRecords, openOrder, openConversation, isClosedOrder };';
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; cache.set(file, module.exports);
    new Function('require', 'module', 'exports', 'uni', 'setInterval', 'clearInterval', js)(id => {
      if (id in mocks) return mocks[id];
      if (id === '@huayue-life/shared') return load(path.resolve(root, '../../../packages/shared/src/reservations.ts'));
      return require(id);
    }, module, module.exports, uni, () => 1, () => {});
    return module.exports;
  }
  return { page: load(path.join(root, kind === 'messages' ? 'pages/messages/index.vue' : 'api/order-chat.ts')), hooks, calls, auth, order, booking,
    setOrders: fn => { orderResponse = fn; }, setReservations: fn => { reservationResponse = fn; } };
}

test('the real message page includes pickup and dining reservations with independent keys, labels and recent-chat sorting', async () => {
  const h = harness(); await h.page.loadMerchantRecords();
  assert.deepEqual(h.page.merchantRecords.value.map(row => [row.key, row.typeLabel]), [['reservation:31', '到店用餐'], ['order:31', '打包自取']]);
  assert.equal(h.page.merchantRecords.value[0].chat.customerUnreadCount, 1);
  h.page.openConversation(h.page.merchantRecords.value[0]);
  h.page.openConversation(h.page.merchantRecords.value[1]);
  h.page.openOrder(h.page.merchantRecords.value[0]);
  h.page.openOrder(h.page.merchantRecords.value[1]);
  assert.deepEqual(h.calls.map(call => call[1]), ['/pages/order/chat?reservationId=31', '/pages/order/chat?orderId=31', '/pages/reservation/detail?id=31', '/pages/order/detail?id=31']);
});
test('seating avoids a duplicate empty dining-order card without hiding an existing order conversation', async () => {
  const h = harness(); h.order.orderType = 'DINE_IN'; h.order.isReservation = false; h.booking.orderId = h.order.id;
  await h.page.loadMerchantRecords(); assert.deepEqual(h.page.merchantRecords.value.map(row => row.key), ['reservation:31']);
  h.order.chatConversation = { id: 'chat-o', lastMessageId: '9', status: 'ACTIVE', customerUnreadCount: 1, merchantUnreadCount: 0 };
  await h.page.loadMerchantRecords(); assert.equal(h.page.merchantRecords.value.length, 2);
});
test('partial request failure keeps the other records visible and a later refresh recovers', async () => {
  const h = harness(); h.setReservations(async () => { throw new Error('网络异常'); });
  await h.page.loadMerchantRecords(); assert.equal(h.page.merchantRecords.value.length, 1); assert.equal(h.page.merchantMessage.value, '网络异常');
  h.setReservations(async () => [h.booking]); await h.page.loadMerchantRecords();
  assert.equal(h.page.merchantRecords.value.length, 2); assert.equal(h.page.merchantMessage.value, '');
});
test('late responses after leaving or changing account cannot show another customer records', async () => {
  const h = harness(); let resolve;
  h.setReservations(() => new Promise(done => { resolve = done; }));
  const pending = h.page.loadMerchantRecords(); h.auth.user = { id: 'another-user' }; h.hooks.onHide(); resolve([h.booking]); await pending;
  assert.deepEqual(h.page.merchantRecords.value, []);
});
test('changing accounts clears previously loaded conversations immediately', async () => {
  const h = harness(); await h.page.loadMerchantRecords(); assert.equal(h.page.merchantRecords.value.length, 2);
  h.auth.user = { id: 'another-user' }; await vue.nextTick();
  assert.deepEqual(h.page.merchantRecords.value, []);
});
test('ended reservation states are read-only records', () => {
  const h = harness(); for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) assert.equal(h.page.isClosedOrder(status), true);
  for (const status of ['PENDING', 'CONFIRMED', 'SEATED']) assert.equal(h.page.isClosedOrder(status), false);
});
test('reservation text, location, image, history and read requests all use reservation endpoints while old orders remain compatible', async () => {
  const h = harness('api');
  await h.page.getOrderChat('reservation:31'); await h.page.listOrderChatMessages('reservation:31', { cursor: '9', limit: 50 });
  await h.page.sendOrderChatMessage('reservation:31', '临时改计划'); await h.page.sendOrderChatLocation('reservation:31', 21.281, 106.197);
  await h.page.sendOrderChatImage('reservation:31', '/local-test.jpg'); await h.page.markOrderChatRead('reservation:31'); await h.page.getOrderChat('31');
  assert.deepEqual(h.calls.map(call => call[0] === 'upload' ? call[1] : call[0]), ['/reservations/31/chat', '/reservations/31/chat/messages', '/reservations/31/chat/messages', '/reservations/31/chat/messages', '/api/v1/reservations/31/chat/images', '/reservations/31/chat/read', '/orders/31/chat']);
  assert.deepEqual(h.calls[1][1].data, { cursor: '9', limit: 50 });
});
