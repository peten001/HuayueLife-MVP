import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../src');
const shared = path.resolve(root, '../../../packages/shared/src/reservations.ts');
function harness(page = 'create') {
  const calls = [], storage = new Map(), hooks = {}, pages = [];
  const item = { id: '20', quantity: 2, remark: '少辣', product: { id: '9', nameZh: '炒饭', priceVnd: '50000' } };
  const booking = { id: '11', status: 'CONFIRMED', proposedScheduledFor: null, items: [], itemAmountVnd: '0', merchant: { id: '3', nameZh: '华越餐厅' } };
  const cart = {
    context: { merchantId: '3', orderType: 'DINE_IN', reservation: true, diningReservationId: '11' },
    cart: { id: '10', items: [item], itemAmountVnd: '100000', totalQuantity: 2 },
    ensureLoaded: async () => calls.push(['ensureCart']), load: async () => calls.push(['loadCart']),
    needsContextSwitch: () => false, hasItems: () => true, switchContext: async () => { calls.push(['switchCart']); return 'ready'; },
    syncContextMetadata: () => {}, resetAfterOrder: () => calls.push(['resetCart']),
  };
  const auth = { user: { id: '2', nickname: '顾客', phone: '0901234567' }, ensureLogin: async () => {} };
  let saveError;
  const mocks = {
    vue: { ...vue, onMounted: () => {} },
    '@dcloudio/uni-app': Object.fromEntries(['onLoad','onShow','onHide','onUnload'].map(key => [key, fn => { hooks[key] = fn; }])),
    '@/i18n': { useI18n: () => ({ locale: vue.ref('zh'), t: key => key }), usePageTitle: () => {}, merchantName: value => value.nameZh },
    '@/api/catalog': { getMerchant: async () => ({ id: '3', nameZh: '华越餐厅', dineInReservationEnabled: true, pickupReservationEnabled: true }) },
    '@/stores/auth': { useAuthStore: () => auth },
    '@/stores/cart': { useCartStore: () => cart },
    '@/stores/app-config': { useAppConfigStore: () => ({ platformOrderingEnabled: true, ensureLoaded: async () => {} }) },
    '@/utils/storage': { getLastContactInfo: () => null, setLastContactInfo: () => {} },
    '@/api/cart': { createOrder: async (payload, key) => { calls.push(['pickup', payload, key]); return { id: '12' }; },
      clearCart: async () => { calls.push(['clearRemote']); return { items: [], totalQuantity: 0 }; }, getCart: async () => ({ items: [item], totalQuantity: 2 }) },
    '@/api/reservations': {
      createDiningReservation: async (payload, key) => { calls.push(['reserve', payload, key]); return booking; },
      getDiningReservation: async () => booking,
      addDiningReservationDishes: async (id, payload, key) => { calls.push(['addDishes', id, payload, key]); if (saveError) throw saveError; return booking; },
    },
    '@/components/ReservationTimeChange.vue': {},
    pinia: { defineStore: (_name, definition) => {
      const store = { ...definition.state() };
      for (const [name, action] of Object.entries(definition.actions)) store[name] = action.bind(store);
      return () => store;
    } },
  };
  const uni = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: key => storage.delete(key),
    navigateTo: options => calls.push(['navigate', options.url]), redirectTo: options => calls.push(['redirect', options.url]),
    navigateBack: options => calls.push(['back', options.delta]),
    showToast: () => {},
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) {
      source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
      const exports = page === 'create' ? 'kind, merchantId, form, displayItems, load, selectDishes, submit'
        : page === 'dishes' ? 'id, load, submit, error, pending' : 'reservation, selectDishes';
      source += `\nexport { ${exports} };`;
    }
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; cache.set(file, module.exports);
    const mockRequire = id => {
      if (id in mocks) return mocks[id];
      if (id === './auth') return mocks['@/stores/auth'];
      if (id === '@huayue-life/shared') return load(shared);
      return require(id);
    };
    new Function('require','module','exports','uni','getCurrentPages',js)(mockRequire,module,module.exports,uni,()=>pages);
    return module.exports;
  }
  const filename = page === 'store' ? 'stores/cart.ts' : `pages/reservation/${page}.vue`;
  return { page: load(path.join(root, filename)), calls, cart, storage, booking, hooks, pages, failSave: value => { saveError = value; } };
}

test('a new dine-in reservation only requests seats and preserves the existing cart', async () => {
  const h = harness(); h.page.merchantId.value = '3';
  await h.page.load();
  assert.deepEqual(h.page.displayItems.value, []);
  h.page.selectDishes();
  assert.equal(h.calls.length, 0, 'no cart switch or early menu navigation');
  await h.page.submit();
  const request = h.calls.find(call => call[0] === 'reserve');
  assert.equal(request[1].withCart, false); assert.equal(request[1].expectedAmountVnd, '0');
  assert.equal(h.calls.some(call => call[0] === 'resetCart'), false);
  assert.equal(h.calls.at(-1)[1], '/pages/reservation/detail?id=11');
});

test('pickup confirmation retains dishes, amount, contacts and the pickup order channel', async () => {
  const h = harness(); h.page.merchantId.value = '3'; h.page.kind.value = 'PICKUP';
  await h.page.load(); await h.page.submit();
  const request = h.calls.find(call => call[0] === 'pickup');
  assert.equal(request[1].orderType, 'PICKUP'); assert.equal(request[1].expectedAmountVnd, '100000');
  assert.equal(request[1].contactPhone, '0901234567'); assert.equal(request[1].reservation, true);
  assert.equal(h.calls.at(-1)[1], '/pages/order/detail?id=12');
});

test('dining menu entry is enabled only after confirmation and a resolved time change', () => {
  const h = harness('detail');
  for (const status of ['PENDING','SEATED','CANCELLED','NO_SHOW','COMPLETED']) {
    h.page.reservation.value = { ...h.booking, status }; h.page.selectDishes();
  }
  h.page.reservation.value = { ...h.booking, proposedScheduledFor: '2026-10-21T12:00:00Z' }; h.page.selectDishes();
  assert.equal(h.calls.length, 0);
  h.page.reservation.value = h.booking; h.page.selectDishes();
  assert.match(h.calls[0][1], /reservation=1&reservationId=11$/);
});

test('uncertain dish submission reuses its saved cart and key after page reopening', async () => {
  const h = harness('dishes'); h.page.id.value = '11'; await h.page.load();
  h.failSave(new Error('Network unavailable')); await h.page.submit();
  const first = h.calls.find(call => call[0] === 'addDishes');
  assert.equal(h.page.pending.value.payload.cartId, '10');
  const retry = harness('dishes'); retry.storage.set('reservation-dishes:2:11', structuredClone(h.storage.get('reservation-dishes:2:11')));
  retry.page.id.value = '11'; retry.booking.status = 'SEATED'; await retry.page.load(); await retry.page.submit();
  const replay = retry.calls.find(call => call[0] === 'addDishes');
  assert.deepEqual(replay, first);
  assert.equal(retry.storage.has('reservation-dishes:2:11'), false);
  assert.equal(retry.calls.at(-1)[1], '/pages/reservation/detail?id=11');
});

test('a cart assigned to another reservation cannot be saved to the current booking', async () => {
  const h = harness('dishes'); h.page.id.value = '12'; h.booking.id = '12';
  await h.page.load(); await h.page.submit();
  assert.equal(h.calls.some(call => call[0] === 'addDishes'), false);
});

test('saving dishes pops menu and cart pages back to the original reservation', async () => {
  const h = harness('dishes'); h.page.id.value = '11'; await h.page.load();
  h.pages.push({ route: 'pages/reservation/detail', options: { id: '11' } },
    { route: 'pages/menu/index', options: { reservationId: '11' } }, { route: 'pages/cart/index' }, { route: 'pages/reservation/dishes' });
  await h.page.submit();
  assert.deepEqual(h.calls.at(-1), ['back', 3]);
});

test('switching bookings clears the shared remote cart once and retains the new booking target', async () => {
  const h = harness('store'); const store = h.page.useCartStore();
  const first = { merchantId: '3', merchantName: '华越餐厅', orderType: 'DINE_IN', reservation: true, diningReservationId: '11' };
  store.context = first; store.cart = h.cart.cart;
  const next = { ...first, diningReservationId: '12' };
  assert.equal(store.needsContextSwitch(next), true);
  assert.equal(await store.clearAndSwitchContext(next), 'switched');
  assert.equal(store.context.diningReservationId, '12'); assert.equal(store.cart.totalQuantity, 0);
  assert.equal(h.calls.filter(call => call[0] === 'clearRemote').length, 1);
});
