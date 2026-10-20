import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../src');
// Execute the real page script with controlled native callbacks. Tencent tiles
// and native event delivery still require WeChat/device acceptance.
function picker({ initialCoordinate = { latitude: 21.281, longitude: 106.197 }, backFails = false } = {}) {
  const hooks = {};
  const events = [];
  const reads = [];
  const moves = [];
  let gps;
  let search;
  let back;
  let initial;
  const channel = { on: (_name, fn) => { initial = fn; }, emit: (...event) => events.push(event) };
  const map = {
    getCenterLocation: (options) => reads.push(options),
    moveToLocation: (options) => moves.push(options),
  };
  const uni = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 730 }),
    createMapContext: () => map,
    getLocation: (options) => { gps = options; },
    chooseLocation: (options) => { search = options; },
    navigateBack: (options) => { back = options; if (backFails) options.fail(); },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) {
      source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
      source += '\nexport { viewport, address, satellite, selectedWgs84, coordinateLabel, canConfirm, errorKey, locating, mapUpdated, regionChanged, locate, searchAddress, confirmLocation };';
    }
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    cache.set(file, module.exports);
    const mockRequire = (id) => {
      if (id === 'vue') return { ...vue, getCurrentInstance: () => ({ proxy: { getOpenerEventChannel: () => channel } }) };
      if (id === '@dcloudio/uni-app') return Object.fromEntries(['onLoad', 'onReady', 'onUnload'].map(key => [key, fn => { hooks[key] = fn; }]));
      if (id === '@/i18n') return { useI18n: () => ({ locale: vue.ref('zh') }), usePageTitle: () => {} };
      if (id === '@/utils/privacy') return { ensurePrivacyAuthorized: async () => true };
      if (id === '@huayue-life/shared') return load(path.resolve(root, '../../..', 'packages/shared/src/delivery-location.ts'));
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      return require(id);
    };
    new Function('require', 'module', 'exports', 'uni', js)(mockRequire, module, module.exports, uni);
    return module.exports;
  }
  const page = load(path.join(root, 'pages/checkout/delivery-location.vue'));
  hooks.onLoad();
  initial({ address: '园区入口', coordinate: initialCoordinate, fallbackCoordinate: { latitude: 21.281, longitude: 106.197 } });
  hooks.onReady();
  function resolveRead(point, index = reads.length - 1) {
    assert.ok(reads[index], 'native center request exists');
    reads[index].success(point);
    reads[index].complete();
  }
  return {
    page, hooks, events, reads, moves, resolveRead,
    gps: () => gps, search: () => search, back: () => back,
    async ready(point = initialCoordinate) { page.mapUpdated(); resolveRead(point); await vue.nextTick(); },
  };
}

test('satellite is the default; a confirmed native center is required', async () => {
  const h = picker();
  assert.equal(h.page.satellite.value, true);
  assert.equal(h.page.canConfirm.value, false);
  await h.ready();
  assert.equal(h.page.canConfirm.value, true);
  assert.equal(h.page.coordinateLabel.value, '21.2810000, 106.1970000');
});

test('a delayed old center cannot replace the latest dragged position', async () => {
  const h = picker(); await h.ready();
  h.page.regionChanged({ type: 'end' });
  const staleRead = h.reads.length - 1;
  h.page.regionChanged({ type: 'begin', causedBy: 'gesture' });
  assert.equal(h.page.canConfirm.value, false);
  h.page.regionChanged({ type: 'end' });
  h.resolveRead({ latitude: 21.282, longitude: 106.198 });
  h.resolveRead({ latitude: 21.1, longitude: 106.1 }, staleRead);
  assert.equal(h.page.coordinateLabel.value, '21.2820000, 106.1980000');
  assert.equal(h.page.canConfirm.value, true);
});

test('late GPS cannot move the map back after the user drags it', async () => {
  const h = picker({ initialCoordinate: null });
  await vue.nextTick();
  assert.ok(h.gps());
  h.page.mapUpdated();
  h.page.regionChanged({ type: 'begin', causedBy: 'gesture' });
  h.page.regionChanged({ type: 'end' });
  h.resolveRead({ latitude: 21.283, longitude: 106.199 });
  h.gps().success({ latitude: 21.2, longitude: 106.1 }); h.gps().complete();
  h.resolveRead({ latitude: 21.283, longitude: 106.199 });
  assert.equal(h.moves.length, 0);
  assert.equal(h.page.coordinateLabel.value, '21.2830000, 106.1990000');
});

test('GPS refusal leaves manual selection usable', async () => {
  const h = picker({ initialCoordinate: null }); await vue.nextTick();
  h.page.mapUpdated(); h.gps().fail(); h.gps().complete();
  h.resolveRead({ latitude: 21.281, longitude: 106.197 });
  assert.equal(h.page.canConfirm.value, true);
});

test('search waits for native recentering, then returns WGS84 only after successful back navigation', async () => {
  const h = picker(); await h.ready();
  await h.page.searchAddress();
  h.search().success({ latitude: 39.9102265, longitude: 116.4037136, address: '园区', name: '北门' }); h.search().complete();
  await vue.nextTick();
  assert.equal(h.page.canConfirm.value, false);
  h.moves.at(-1).success(); h.resolveRead({ latitude: 21.281, longitude: 106.197 });
  assert.equal(h.page.canConfirm.value, false, 'old center is not accepted');
  h.page.regionChanged({ type: 'end' }); h.resolveRead({ latitude: 39.9102265, longitude: 116.4037136 });
  assert.equal(h.page.canConfirm.value, true);
  const confirmation = h.page.confirmLocation();
  h.resolveRead({ latitude: 39.9102265, longitude: 116.4037136 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.length, 0);
  h.hooks.onUnload(); h.back().success(); await confirmation;
  assert.deepEqual(h.events, [['deliveryLocationSelected', { address: '园区 北门', coordinate: { latitude: 39.908823, longitude: 116.39747 }, coordinateSystem: 'WGS84' }]]);
});

test('failed back navigation and cancellation never save a new delivery point', async () => {
  const h = picker({ backFails: true }); await h.ready();
  const confirmation = h.page.confirmLocation(); h.resolveRead({ latitude: 21.281, longitude: 106.197 }); await confirmation;
  assert.equal(h.events.length, 0); assert.equal(h.page.errorKey.value, 'readFailed');
  h.hooks.onUnload();
  assert.deepEqual(h.events, [['deliveryLocationCancelled']]);
});

test('a failed center read disables confirmation and excessive address length is rejected', async () => {
  const h = picker(); await h.ready();
  h.page.regionChanged({ type: 'end' }); h.reads.at(-1).fail(); h.reads.at(-1).complete();
  assert.equal(h.page.canConfirm.value, false);
  h.page.regionChanged({ type: 'end' }); h.resolveRead({ latitude: 21.281, longitude: 106.197 });
  h.page.address.value = '长'.repeat(255);
  await h.page.confirmLocation();
  assert.equal(h.page.errorKey.value, 'addressTooLong');
  assert.equal(h.events.length, 0);
});

function checkout(cachedContact) {
  let cache = cachedContact;
  let selection = null;
  const modules = {};
  const mocks = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {}, watch: () => {} },
    '@dcloudio/uni-app': { onShow: () => {} },
    '@/i18n': { useI18n: () => ({ locale: vue.ref('zh'), t: key => key }), usePageTitle: () => {}, translateApiError: text => text },
    '@/api/cart': {}, '@/api/catalog': { getMerchant: async () => ({ latitude: 21.281, longitude: 106.197 }) },
    '@/stores/app-config': { useAppConfigStore: () => ({ platformOrderingEnabled: true, ensureLoaded: async () => {} }) },
    '@/stores/auth': { useAuthStore: () => ({ ensureLogin: async () => {}, user: null }) },
    '@/stores/cart': { useCartStore: () => ({ context: { merchantId: 'fixture', orderType: 'DELIVERY' }, cart: null, load: async () => {} }) },
    '@/stores/location': { useLocationStore: () => ({ latitude: 21.281, longitude: 106.197, city: 'bac-giang' }) },
    '@/utils/storage': { getLastContactInfo: () => cache, setLastContactInfo: value => { cache = value; } },
    '@/utils/delivery-location': { chooseDeliveryLocation: async () => selection, deliveryLocationText: (_locale, key) => key },
  };
  function load(file) {
    if (modules[file]) return modules[file];
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
      + '\nexport { form, bootstrapCheckout, chooseLocation, buildOrderRequest };';
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; modules[file] = module.exports;
    const mockRequire = id => {
      if (id in mocks) return mocks[id];
      if (id === '@huayue-life/shared') return load(path.resolve(root, '../../..', 'packages/shared/src/delivery-location.ts'));
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      return require(id);
    };
    new Function('require', 'module', 'exports', 'uni', js)(mockRequire, module, module.exports, { showToast: () => {} });
    return module.exports;
  }
  return { page: load(path.join(root, 'pages/checkout/index.vue')), cache: () => cache, select: value => { selection = value; } };
}

test('checkout migrates legacy Tencent cache once and submits canonical coordinates plus address suffix', async () => {
  const h = checkout({ contactPhone: '+84123456789', deliveryAddress: '旧门口', deliveryLatitude: 39.9102265, deliveryLongitude: 116.4037136 });
  await h.page.bootstrapCheckout();
  assert.equal(h.page.form.deliveryLatitude, 39.908823);
  assert.equal(h.page.form.deliveryLongitude, 116.39747);
  h.select({ address: '园区北门', coordinate: { latitude: 39.908823, longitude: 116.39747 }, coordinateSystem: 'WGS84' });
  await h.page.chooseLocation();
  assert.equal(h.cache().deliveryCoordinateSystem, 'WGS84');
  h.page.form.deliveryAddress = '园区北门，2 号岗亭';
  await h.page.bootstrapCheckout();
  const request = h.page.buildOrderRequest();
  assert.equal(request.deliveryLatitude, 39.908823);
  assert.equal(request.deliveryLongitude, 116.39747);
  assert.equal(request.deliveryAddress, '园区北门，2 号岗亭\nGPS: 39.9088230, 116.3974700');
  const nextVisit = checkout(h.cache()); await nextVisit.page.bootstrapCheckout();
  assert.equal(nextVisit.page.form.deliveryLatitude, 39.908823, 'WGS84 cache is not converted twice');
});

test('cancelling the picker preserves checkout edits and length validation includes GPS', async () => {
  const h = checkout({ contactPhone: '+84123456789', deliveryAddress: '北门', deliveryLatitude: 21.281, deliveryLongitude: 106.197, deliveryCoordinateSystem: 'WGS84' });
  await h.page.bootstrapCheckout();
  h.page.form.deliveryAddress = '保留手工补充的 3 栋';
  await h.page.chooseLocation();
  assert.equal(h.page.form.deliveryAddress, '保留手工补充的 3 栋');
  assert.equal(h.page.form.deliveryLatitude, 21.281);
  h.page.form.deliveryAddress = '长'.repeat(255);
  assert.throws(() => h.page.buildOrderRequest(), /addressTooLong/);
});
