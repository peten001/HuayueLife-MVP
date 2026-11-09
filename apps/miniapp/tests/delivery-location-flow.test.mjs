import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as vue from 'vue';
import { compileTemplate } from 'vue/compiler-sfc';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../src');
const bacGiang = { latitude: 21.281, longitude: 106.197 };
const initial = { coordinate: bacGiang, fallbackCoordinate: bacGiang };
const contact = { contactPhone: '+84123456789', deliveryAddress: '旧地址', deliveryLatitude: 21.281, deliveryLongitude: 106.197, deliveryCoordinateSystem: 'WGS84' };

// Run the real native-picker adapter and checkout script together. Only native
// callbacks, storage and unrelated APIs are simulated; no production orders.
function harness({ cachedContact = contact, privacyAuthorized = true, withCart = false, previewError, orderType = 'DELIVERY', merchantProfile = {} } = {}) {
  const hooks = {};
  const choices = [];
  const toasts = [];
  const modals = [];
  const redirects = [];
  const requests = { preview: [], create: [] };
  let cache = cachedContact;
  const uni = {
    chooseLocation: options => choices.push(options),
    showToast: options => toasts.push(options),
    showModal: options => { modals.push(options); options.success?.({ confirm: true }); },
    redirectTo: options => redirects.push(options),
    navigateTo: () => assert.fail('delivery selection must use the native picker directly'),
  };
  const mocks = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {}, watch: () => {} },
    '@dcloudio/uni-app': { onShow: fn => { hooks.onShow = fn; } },
    '@/i18n': { useI18n: () => ({ locale: vue.ref('zh'), t: key => key }), usePageTitle: () => {}, translateApiError: text => text },
    '@/api/cart': {
      previewOrder: async payload => { requests.preview.push(payload); if (previewError) throw previewError; return { itemAmountVnd: '50000', deliveryFeeVnd: '15000', totalAmountVnd: '65000', deliveryRangeVerified: true, requiresPhoneConfirmation: false }; },
      createOrder: async payload => { requests.create.push(payload); return { id: 'fixture', orderNo: 'FIXTURE', orderType }; },
    },
    '@/api/catalog': { getMerchant: async () => ({ ...bacGiang, province: '商家所在省', district: '商家所在区', ...merchantProfile }) },
    '@/stores/app-config': { useAppConfigStore: () => ({ platformOrderingEnabled: true, ensureLoaded: async () => {} }) },
    '@/stores/auth': { useAuthStore: () => ({ ensureLogin: async () => {}, user: null }) },
    '@/stores/cart': { useCartStore: () => ({ context: { merchantId: 'fixture', orderType }, cart: withCart ? { items: [{ id: 'fixture' }], itemAmountVnd: '50000' } : null, load: async () => {}, resetAfterOrder: () => {} }) },
    '@/stores/location': { useLocationStore: () => ({ ...bacGiang, city: 'Bac Giang' }) },
    '@/utils/storage': { getLastContactInfo: () => cache, setLastContactInfo: value => { cache = value; } },
    '@/utils/privacy': { ensurePrivacyAuthorized: async () => privacyAuthorized },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) source = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
      + '\nexport { form, locationLabel, bootstrapCheckout, chooseLocation, buildOrderRequest, deliveryAddressLimit, checkoutText, deliverySubmissionBlock, submit, clearPreviewTimer, message, submitting, selectingLocation, t };';
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; modules.set(file, module.exports);
    const mockRequire = id => {
      if (id in mocks) return mocks[id];
      if (id === '@huayue-life/shared') return load(path.resolve(root, '../../..', 'packages/shared/src/index.ts'));
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      return require(id);
    };
    new Function('require', 'module', 'exports', 'uni', 'console', js)(mockRequire, module, module.exports, uni, { ...console, log: () => {} });
    return module.exports;
  }
  return {
    location: load(path.join(root, 'utils/delivery-location.ts')),
    page: load(path.join(root, 'pages/checkout/index.vue')),
    hooks, choices, toasts, modals, requests, redirects, cache: () => cache,
    async native() {
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(choices.length, 'native location picker was opened');
      return choices.at(-1);
    },
  };
}

// Render the real checkout button template to verify its disabled state.
function mountCheckoutControl(page, template, tag) {
  const { code, errors } = compileTemplate({ source: template, filename: 'checkout-control.vue', id: 'checkout-control', compilerOptions: { isCustomElement: tag => tag === 'text' } });
  assert.deepEqual(errors, []);
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => id === 'vue' ? vue : require(id), module, module.exports);
  const renderer = vue.createRenderer({
    createElement: type => ({ type, props: {}, children: [] }),
    createText: text => ({ type: 'text', text }),
    createComment: text => ({ type: 'comment', text }),
    setText: (node, text) => { node.text = text; },
    setComment: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; },
    patchProp: (node, key, previous, next) => {
      node.props[key] = next;
      if (key === 'value' && !node.stale) node.displayedValue = next;
    },
    insert: (node, parent) => { node.parent = parent; parent.children.push(node); },
    remove: node => { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
    parentNode: node => node.parent,
    nextSibling: () => null,
  });
  const container = { children: [] };
  const app = renderer.createApp({ setup: () => page, render: module.exports.render });
  app.mount(container);
  return {
    node: () => container.children.find(node => node.type === tag),
    input(node, value) {
      node.props.onInput({ detail: { value }, currentTarget: { dataset: { addressRevision: node.props['data-address-revision'] } } });
    },
    unmount: () => app.unmount(),
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

test('out-of-range delivery cannot be submitted or confirmed through even with an empty address', async () => {
  for (const address of ['远处收餐点', '']) {
    const h = harness({ withCart: true, merchantProfile: { deliveryRadiusKm: '5' } });
    await h.page.bootstrapCheckout(); h.page.clearPreviewTimer();
    Object.assign(h.page.form, { deliveryAddress: address, deliveryLatitude: 21.4, deliveryLongitude: 106.4 });
    assert.equal(h.page.deliverySubmissionBlock.value, 'deliveryRangeExceeded');
    assert.throws(() => h.page.buildOrderRequest(), /deliveryRangeExceeded/);
    await h.page.submit();
    assert.equal(h.page.message.value, 'deliveryRangeExceeded');
    assert.equal(h.modals.length, 0);
    assert.deepEqual(h.requests, { preview: [], create: [] });
  }
});

test('text-only delivery cannot bypass range validation by omitting coordinates', async () => {
  const h = harness({ withCart: true, cachedContact: { ...contact, deliveryLatitude: undefined, deliveryLongitude: undefined } });
  await h.page.bootstrapCheckout(); h.page.clearPreviewTimer();
  await h.page.submit();
  assert.equal(h.page.deliverySubmissionBlock.value, 'deliveryLocationRequired');
  assert.equal(h.modals.length, 0);
  assert.equal(h.requests.create.length, 0);
});

test('selecting a point within range unlocks checkout and allows exactly one order', async () => {
  const h = harness({ withCart: true, merchantProfile: { deliveryRadiusKm: '5' } });
  await h.page.bootstrapCheckout(); h.page.clearPreviewTimer();
  const template = readFileSync(path.join(root, 'pages/checkout/index.vue'), 'utf8').match(/<button class="submit"[\s\S]*?<\/button>/)[0];
  const button = mountCheckoutControl(h.page, template, 'button');
  assert.equal(button.node().props.disabled, false);
  Object.assign(h.page.form, { deliveryLatitude: 21.4, deliveryLongitude: 106.4 });
  await vue.nextTick();
  assert.equal(button.node().props.disabled, true);
  await h.page.submit();
  const choosing = h.page.chooseLocation();
  (await h.native()).success({ latitude: 21.282, longitude: 106.198, address: '范围内入口', name: '' });
  await choosing; h.page.clearPreviewTimer();
  assert.equal(h.page.deliverySubmissionBlock.value, '');
  assert.equal(h.page.message.value, '');
  assert.equal(button.node().props.disabled, false);
  await button.node().props.onClick();
  assert.equal(h.requests.preview.length, 1);
  assert.equal(h.requests.create.length, 1);
  assert.equal(h.requests.create[0].deliveryLatitude, 21.282);
  assert.equal(h.page.message.value, '');
  assert.deepEqual(h.redirects, [{ url: '/pages/order/detail?id=fixture' }]);
  button.unmount();
});

test('a rejected server delivery preview never falls through to order creation', async () => {
  for (const text of ['配送地址超出商家配送范围，请重新选择地址', 'Network Error']) {
    const h = harness({ withCart: true, previewError: new Error(text) });
    await h.page.bootstrapCheckout(); h.page.clearPreviewTimer();
    await h.page.submit();
    assert.equal(h.requests.preview.length, 1);
    assert.equal(h.requests.create.length, 0);
    assert.equal(h.page.message.value, text);
  }
});

test('zero delivery radius only permits the exact merchant location', async () => {
  const h = harness({ merchantProfile: { deliveryRadiusKm: '0' } });
  await h.page.bootstrapCheckout();
  assert.equal(h.page.deliverySubmissionBlock.value, '');
  h.page.form.deliveryLatitude = 21.282;
  assert.equal(h.page.deliverySubmissionBlock.value, 'deliveryRangeExceeded');
});

test('pickup and dine-in remain available when delivery coordinates are absent or far away', async () => {
  for (const orderType of ['PICKUP', 'DINE_IN']) {
    const h = harness({ withCart: true, orderType, cachedContact: { ...contact, deliveryLatitude: 21.4, deliveryLongitude: 106.4 } });
    await h.page.bootstrapCheckout(); h.page.clearPreviewTimer();
    assert.equal(h.page.deliverySubmissionBlock.value, '');
    await h.page.submit();
    assert.equal(h.requests.create.length, 1);
    assert.equal(h.page.message.value, '');
    assert.equal(h.redirects.length, 1);
  }
});
