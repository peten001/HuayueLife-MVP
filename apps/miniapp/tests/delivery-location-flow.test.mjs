import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../src');
const bacGiang = { latitude: 21.281, longitude: 106.197 };
const initial = { coordinate: bacGiang, fallbackCoordinate: bacGiang };
const contact = { contactPhone: '+84123456789', deliveryAddress: '旧地址', deliveryLatitude: 21.281, deliveryLongitude: 106.197, deliveryCoordinateSystem: 'WGS84' };

// Run the real native-picker adapter and checkout script together. Only native
// callbacks, storage and unrelated APIs are simulated; no production orders.
function harness({ cachedContact = contact, privacyAuthorized = true } = {}) {
  const hooks = {};
  const choices = [];
  const toasts = [];
  let cache = cachedContact;
  const uni = {
    chooseLocation: options => choices.push(options),
    showToast: options => toasts.push(options),
    navigateTo: () => assert.fail('delivery selection must use the native picker directly'),
  };
  const mocks = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {}, watch: () => {} },
    '@dcloudio/uni-app': { onShow: fn => { hooks.onShow = fn; } },
    '@/i18n': { useI18n: () => ({ locale: vue.ref('zh'), t: key => key }), usePageTitle: () => {}, translateApiError: text => text },
    '@/api/cart': {},
    '@/api/catalog': { getMerchant: async () => ({ ...bacGiang, province: '商家所在省', district: '商家所在区' }) },
    '@/stores/app-config': { useAppConfigStore: () => ({ platformOrderingEnabled: true, ensureLoaded: async () => {} }) },
    '@/stores/auth': { useAuthStore: () => ({ ensureLogin: async () => {}, user: null }) },
    '@/stores/cart': { useCartStore: () => ({ context: { merchantId: 'fixture', orderType: 'DELIVERY' }, cart: null, load: async () => {} }) },
    '@/stores/location': { useLocationStore: () => ({ ...bacGiang, city: 'Bac Giang' }) },
    '@/utils/storage': { getLastContactInfo: () => cache, setLastContactInfo: value => { cache = value; } },
    '@/utils/privacy': { ensurePrivacyAuthorized: async () => privacyAuthorized },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
      + '\nexport { form, locationLabel, bootstrapCheckout, chooseLocation, buildOrderRequest };';
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; modules.set(file, module.exports);
    const mockRequire = id => {
      if (id in mocks) return mocks[id];
      if (id === '@huayue-life/shared') return load(path.resolve(root, '../../..', 'packages/shared/src/index.ts'));
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      return require(id);
    };
    new Function('require', 'module', 'exports', 'uni', js)(mockRequire, module, module.exports, uni);
    return module.exports;
  }
  return {
    location: load(path.join(root, 'utils/delivery-location.ts')),
    page: load(path.join(root, 'pages/checkout/index.vue')),
    hooks, choices, toasts, cache: () => cache,
    async native() {
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(choices.length, 'native location picker was opened');
      return choices.at(-1);
    },
  };
}

test('native selection returns a new Vietnamese address and unchanged WGS84 coordinates', async () => {
  const h = harness();
  const choosing = h.location.chooseDeliveryLocation(initial);
  const native = await h.native();
  assert.equal(native.latitude, 21.281); assert.equal(native.longitude, 106.197);
  native.success({ address: 'Bắc Giang', name: 'Cổng số 2', latitude: 21.282, longitude: 106.198 });
  assert.deepEqual(await choosing, {
    address: 'Bắc Giang Cổng số 2', coordinate: { latitude: 21.282, longitude: 106.198 }, coordinateSystem: 'WGS84',
  });
});

test('native map uses GCJ02 in mainland China and returns WGS84 exactly once', async () => {
  const h = harness();
  const point = { latitude: 39.908823, longitude: 116.39747 };
  const choosing = h.location.chooseDeliveryLocation({ coordinate: point, fallbackCoordinate: bacGiang });
  const native = await h.native();
  assert.ok(Math.abs(native.latitude - 39.9102265) < 0.0000002);
  assert.ok(Math.abs(native.longitude - 116.4037136) < 0.0000002);
  native.success({ address: '园区', name: '北门', latitude: 39.9102265, longitude: 116.4037136 });
  assert.deepEqual(await choosing, { address: '园区 北门', coordinate: point, coordinateSystem: 'WGS84' });
});

test('native address and place name are not duplicated and legacy GPS text is removed', async () => {
  const h = harness();
  const choosing = h.location.chooseDeliveryLocation(initial);
  (await h.native()).success({ ...bacGiang, address: '园区北门\nGPS: 21.2810000, 106.1970000', name: '北门' });
  assert.equal((await choosing).address, '园区北门');
});

test('a place name alone is retained when the provider supplies no street address', async () => {
  const h = harness();
  const choosing = h.location.chooseDeliveryLocation(initial);
  (await h.native()).success({ ...bacGiang, address: '', name: 'Cổng phía đông' });
  assert.equal((await choosing).address, 'Cổng phía đông');
});

test('missing or invalid initial coordinates use the valid fallback point', async () => {
  for (const coordinate of [null, { latitude: 999, longitude: NaN }]) {
    const h = harness();
    const choosing = h.location.chooseDeliveryLocation({ coordinate, fallbackCoordinate: bacGiang });
    const native = await h.native();
    assert.equal(native.latitude, 21.281); assert.equal(native.longitude, 106.197);
    native.fail({ errMsg: 'chooseLocation:fail cancel' }); assert.equal(await choosing, null);
  }
});

test('privacy refusal does not open a map or change checkout edits', async () => {
  const h = harness({ privacyAuthorized: false }); await h.page.bootstrapCheckout();
  h.page.form.deliveryAddress = '手工补充的 3 栋';
  await h.page.chooseLocation();
  assert.equal(h.choices.length, 0);
  assert.equal(h.page.form.deliveryAddress, '手工补充的 3 栋');
  assert.equal(h.cache(), contact);
});

test('cancelling the native picker preserves edited address, coordinates and cache', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  h.page.form.deliveryAddress = '保留手工补充的 3 栋';
  const choosing = h.page.chooseLocation();
  h.hooks.onShow();
  (await h.native()).fail({ errMsg: 'chooseLocation:fail cancel' });
  await choosing; await h.page.bootstrapCheckout();
  assert.equal(h.page.form.deliveryAddress, '保留手工补充的 3 栋');
  assert.equal(h.page.form.deliveryLatitude, 21.281);
  assert.equal(h.cache(), contact);
  assert.equal(h.toasts.length, 0);
});

test('a native failure keeps the old address and permits another attempt', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  const choosing = h.page.chooseLocation();
  (await h.native()).fail({ errMsg: 'chooseLocation:fail auth deny' }); await choosing;
  assert.equal(h.page.form.deliveryAddress, '旧地址');
  assert.equal(h.cache(), contact); assert.equal(h.toasts.length, 1);
  const retry = h.page.chooseLocation();
  (await h.native()).success({ ...bacGiang, address: '重选地址', name: '' }); await retry;
  assert.equal(h.page.form.deliveryAddress, '重选地址');
});

test('invalid native coordinates cannot overwrite a valid address', async () => {
  for (const point of [{ latitude: 0, longitude: 0 }, { latitude: 91, longitude: 106 }, { latitude: NaN, longitude: 106 }]) {
    const h = harness(); await h.page.bootstrapCheckout();
    const choosing = h.page.chooseLocation();
    (await h.native()).success({ ...point, address: '错误落点', name: '' }); await choosing;
    assert.equal(h.page.form.deliveryAddress, '旧地址');
    assert.equal(h.page.form.deliveryLatitude, 21.281);
    assert.equal(h.cache(), contact); assert.equal(h.toasts.length, 1);
  }
});

test('native confirmation updates checkout, cache and order together despite onShow', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  h.page.form.contactName = '本次联系人';
  const choosing = h.page.chooseLocation();
  const native = await h.native(); h.hooks.onShow();
  native.success({ latitude: 21.282, longitude: 106.198, address: '园区东门', name: '2 号岗亭' });
  await choosing; await h.page.bootstrapCheckout();
  assert.equal(h.page.form.deliveryAddress, '园区东门 2 号岗亭');
  assert.equal(h.cache().deliveryAddress, '园区东门 2 号岗亭');
  assert.equal(h.cache().deliveryCoordinateSystem, 'WGS84');
  assert.equal(h.cache().contactName, '本次联系人');
  assert.deepEqual(h.page.buildOrderRequest(), {
    merchantId: 'fixture', orderType: 'DELIVERY', contactName: '本次联系人', contactPhone: '+84123456789',
    deliveryAddress: '园区东门 2 号岗亭\nGPS: 21.2820000, 106.1980000', deliveryLatitude: 21.282, deliveryLongitude: 106.198,
  });
});

test('empty native address clears old text and prompts for details without inventing a merchant address', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  const choosing = h.page.chooseLocation();
  (await h.native()).success({ latitude: 21.282, longitude: 106.198, address: '', name: '' }); await choosing;
  assert.equal(h.page.form.deliveryAddress, '');
  assert.equal(h.cache().deliveryAddress, '');
  assert.equal(h.page.form.deliveryLatitude, 21.282);
  assert.equal(h.page.locationLabel.value, '已选择收餐点，请补充详细配送地址');
});

test('reselection opens once per tap sequence and keeps the latest confirmed address', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  const first = h.page.chooseLocation(); await h.page.chooseLocation();
  (await h.native()).success({ ...bacGiang, address: '第一次地址', name: '' }); await first;
  assert.equal(h.choices.length, 1);
  const second = h.page.chooseLocation();
  const native = await h.native(); assert.equal(native.latitude, 21.281);
  native.success({ latitude: 21.283, longitude: 106.199, address: '第二次地址', name: '' }); await second;
  assert.equal(h.choices.length, 2);
  assert.equal(h.cache().deliveryAddress, '第二次地址');
  assert.equal(h.page.form.deliveryLatitude, 21.283);
});

test('legacy Tencent cache migrates once; new WGS84 cache is not converted again', async () => {
  const h = harness({ cachedContact: { ...contact, deliveryCoordinateSystem: undefined, deliveryLatitude: 39.9102265, deliveryLongitude: 116.4037136 } });
  await h.page.bootstrapCheckout();
  assert.equal(h.page.form.deliveryLatitude, 39.908823);
  assert.equal(h.page.form.deliveryLongitude, 116.39747);
  const choosing = h.page.chooseLocation();
  (await h.native()).success({ latitude: 39.9102265, longitude: 116.4037136, address: '园区北门', name: '' }); await choosing;
  const next = harness({ cachedContact: h.cache() }); await next.page.bootstrapCheckout();
  assert.equal(next.page.form.deliveryLatitude, 39.908823);
  assert.equal(next.page.form.deliveryLongitude, 116.39747);
});

test('manual details survive returning to checkout and GPS is included in length validation', async () => {
  const h = harness(); await h.page.bootstrapCheckout();
  const choosing = h.page.chooseLocation();
  (await h.native()).success({ ...bacGiang, address: '园区北门', name: '' }); await choosing;
  h.page.form.deliveryAddress += '，3 栋入口';
  h.hooks.onShow(); await h.page.bootstrapCheckout();
  assert.equal(h.page.buildOrderRequest().deliveryAddress, '园区北门，3 栋入口\nGPS: 21.2810000, 106.1970000');
  h.page.form.deliveryAddress = '长'.repeat(255);
  assert.throws(() => h.page.buildOrderRequest(), /地址过长/);
});
