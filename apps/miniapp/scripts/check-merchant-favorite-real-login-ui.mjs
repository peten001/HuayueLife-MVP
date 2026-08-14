import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMerchantFavoriteGate } from '../src/utils/merchant-favorite-gate.ts';
import { createOneTapLoginUiController } from '../src/utils/one-tap-login-ui.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(scriptDir, '..');
const componentPath = path.join(miniappRoot, 'src/components/WechatOneTapLogin.vue');
const detailPath = path.join(miniappRoot, 'src/pages/merchant/detail.vue');
const profilePath = path.join(miniappRoot, 'src/pages/profile/index.vue');
const component = fs.readFileSync(componentPath, 'utf8');
const detail = fs.readFileSync(detailPath, 'utf8');
const profile = fs.readFileSync(profilePath, 'utf8');

function unauthorized() {
  const error = new Error('Unauthorized');
  error.statusCode = 401;
  return error;
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

function createIntegration({
  authenticated = false,
  persistFavorite = async () => undefined,
  isContextCurrent = () => true,
} = {}) {
  let loggedIn = authenticated;
  let loginOpenCalls = 0;
  let favoriteFailures = 0;
  const visibilityChanges = [];
  const persistCalls = [];
  const stateChanges = [];
  const loginUi = createOneTapLoginUiController({
    onVisibilityChange: (visible) => visibilityChanges.push(visible),
  });
  const gate = createMerchantFavoriteGate({
    isAuthenticated: () => loggedIn,
    requestLogin: () => {
      loginOpenCalls += 1;
      return loginUi.open();
    },
    persistFavorite: async (merchantId, desiredState) => {
      persistCalls.push({ merchantId, desiredState });
      await persistFavorite(merchantId, desiredState);
    },
    isContextCurrent,
    onStateChanged: (desiredState) => stateChanges.push(desiredState),
    onFavoriteFailure: () => {
      favoriteFailures += 1;
    },
  });

  return {
    gate,
    loginUi,
    persistCalls,
    stateChanges,
    visibilityChanges,
    setAuthenticated(value) {
      loggedIn = value;
    },
    get loginOpenCalls() {
      return loginOpenCalls;
    },
    get favoriteFailures() {
      return favoriteFailures;
    },
  };
}

test('1 unauthenticated favorite click starts the real login UI flow', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(integration.loginOpenCalls, 1);
  integration.loginUi.finish('cancelled');
  await action;
});

test('2 favorite action does not run before the login UI completes', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(integration.persistCalls.length, 0);
  integration.loginUi.finish('cancelled');
  await action;
});

test('3 merchant detail calls the exposed real login component open method', () => {
  assert.match(detail, /<WechatOneTapLogin ref="favoriteLoginUi" :show-success-toast="false" \/>/);
  assert.match(detail, /favoriteLoginUi\.value\?\.open\(\) \?\? 'failed'/);
  assert.doesNotMatch(detail, /requireLoginForAction\('favorite'/);
});

test('4 opening the login UI sets visible=true', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(integration.loginUi.visible, true);
  assert.deepEqual(integration.visibilityChanges, [true]);
  integration.loginUi.finish('cancelled');
  await action;
});

test('5 opening the UI cannot trigger a premature login-failure toast', () => {
  const openBlock = sliceBetween(component, 'function open() {', 'function complete(');
  assert.doesNotMatch(openBlock, /loginWithWechat|showToast|wechatLoginFailedSimple/);
});

test('6 user login success verifies auth and emits success', () => {
  const loginBlock = sliceBetween(component, 'async function handleLogin() {', 'onBeforeUnmount(');
  assert.match(loginBlock, /await auth\.loginWithWechat\(\)/);
  assert.match(loginBlock, /!auth\.user \|\| !getToken\(\)/);
  assert.match(loginBlock, /complete\('success'\)/);
  assert.match(component, /if \(outcome === 'success'\) emit\('success'\)/);
});

test('7 login success consumes the pending intent once', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  integration.setAuthenticated(true);
  assert.equal(integration.loginUi.finish('success'), true);
  assert.equal(await action, 'completed');
  assert.equal(integration.loginUi.finish('success'), false);
});

test('8 successful login performs the favorite action exactly once', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  integration.setAuthenticated(true);
  integration.loginUi.finish('success');
  await action;
  assert.deepEqual(integration.persistCalls, [{ merchantId: '1', desiredState: true }]);
  assert.deepEqual(integration.stateChanges, [true]);
});

test('9 cancelling or closing the UI performs no favorite action', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  integration.loginUi.finish('cancelled');
  assert.equal(await action, 'cancelled');
  assert.equal(integration.persistCalls.length, 0);
  assert.equal(integration.stateChanges.length, 0);
});

test('10 cancelling the UI has no login-failure toast path', () => {
  const cancelBlock = sliceBetween(component, 'function cancel() {', 'function handleBackdropTap()');
  assert.doesNotMatch(cancelBlock, /showToast|wechatLoginFailedSimple/);
  assert.match(cancelBlock, /complete\('cancelled'\)/);
});

test('11 privacy authorization denial follows cancellation semantics', () => {
  assert.match(
    component,
    /error\.message === t\('privacyAuthorizationRequired'\)[\s\S]*complete\('cancelled'\);[\s\S]*return;/,
  );
  assert.doesNotMatch(component, /open-type="getPhoneNumber"/);
});

test('12 only a real login request failure displays the login failure toast', () => {
  const loginBlock = sliceBetween(component, 'async function handleLogin() {', 'onBeforeUnmount(');
  assert.match(loginBlock, /await auth\.loginWithWechat\(\)/);
  assert.match(loginBlock, /catch \(error\)[\s\S]*uni\.showToast\([\s\S]*complete\('failed'\)/);
});

test('13 logged-in favorite does not open the login UI', async () => {
  const integration = createIntegration({ authenticated: true });
  await integration.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(integration.loginOpenCalls, 0);
  assert.equal(integration.loginUi.visible, false);
});

test('14 a 401 opens the same real login UI', async () => {
  let calls = 0;
  const integration = createIntegration({
    authenticated: true,
    persistFavorite: async () => {
      calls += 1;
      if (calls === 1) throw unauthorized();
    },
  });
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(integration.loginUi.visible, true);
  assert.equal(integration.loginOpenCalls, 1);
  integration.setAuthenticated(true);
  integration.loginUi.finish('success');
  await action;
});

test('15 401 login success retries the favorite action once', async () => {
  let calls = 0;
  const integration = createIntegration({
    authenticated: true,
    persistFavorite: async () => {
      calls += 1;
      if (calls === 1) throw unauthorized();
    },
  });
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  await new Promise((resolve) => setImmediate(resolve));
  integration.setAuthenticated(true);
  integration.loginUi.finish('success');
  assert.equal(await action, 'completed');
  assert.equal(integration.persistCalls.length, 2);
});

test('16 a second 401 stops without reopening the login UI', async () => {
  const integration = createIntegration({
    authenticated: true,
    persistFavorite: async () => {
      throw unauthorized();
    },
  });
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  await new Promise((resolve) => setImmediate(resolve));
  integration.setAuthenticated(true);
  integration.loginUi.finish('success');
  assert.equal(await action, 'favorite-failed');
  assert.equal(integration.loginOpenCalls, 1);
  assert.equal(integration.persistCalls.length, 2);
  assert.equal(integration.favoriteFailures, 1);
});

test('17 double tap opens one modal and keeps one pending intent', async () => {
  const integration = createIntegration();
  const first = integration.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(
    await integration.gate.toggle({ merchantId: '1', currentState: false }),
    'ignored',
  );
  assert.equal(integration.loginOpenCalls, 1);
  integration.loginUi.finish('cancelled');
  await first;
});

test('18 duplicate success signal performs one favorite action', async () => {
  const integration = createIntegration();
  const action = integration.gate.toggle({ merchantId: '1', currentState: false });
  integration.setAuthenticated(true);
  assert.equal(integration.loginUi.finish('success'), true);
  assert.equal(integration.loginUi.finish('success'), false);
  await action;
  assert.equal(integration.persistCalls.length, 1);
});

test('19 merchant A pending cannot act after navigation to merchant B', async () => {
  let currentMerchantId = 'A';
  const integration = createIntegration({
    isContextCurrent: (merchantId) => merchantId === currentMerchantId,
  });
  const action = integration.gate.toggle({ merchantId: 'A', currentState: false });
  currentMerchantId = 'B';
  integration.setAuthenticated(true);
  integration.loginUi.finish('success');
  assert.equal(await action, 'context-changed');
  assert.equal(integration.persistCalls.length, 0);
});

test('the profile page and merchant detail share the same real login component', () => {
  assert.match(profile, /<WechatOneTapLogin v-if="!loggedIn" inline \/>/);
  assert.match(detail, /import WechatOneTapLogin from '@\/components\/WechatOneTapLogin\.vue'/);
  assert.match(component, /class="wechat-login-button"[\s\S]*@tap="handleLogin"/);
  assert.match(component, /class="privacy-agreement"/);
  assert.match(component, /defineExpose\(\{ open, close: cancel \}\)/);
});

if (process.argv.includes('--build')) {
  test('production build contains the real login component and both runtime hookups', () => {
    const buildRoot = path.join(miniappRoot, 'dist/build/mp-weixin');
    const componentWxml = fs.readFileSync(
      path.join(buildRoot, 'components/WechatOneTapLogin.wxml'),
      'utf8',
    );
    const detailJson = fs.readFileSync(path.join(buildRoot, 'pages/merchant/detail.json'), 'utf8');
    const detailWxml = fs.readFileSync(path.join(buildRoot, 'pages/merchant/detail.wxml'), 'utf8');
    const profileJson = fs.readFileSync(path.join(buildRoot, 'pages/profile/index.json'), 'utf8');
    const profileWxml = fs.readFileSync(path.join(buildRoot, 'pages/profile/index.wxml'), 'utf8');

    assert.match(componentWxml, /wechat-login-button/);
    assert.match(componentWxml, /privacy-agreement/);
    assert.match(componentWxml, /login-overlay/);
    assert.match(detailJson, /WechatOneTapLogin/);
    assert.match(detailWxml, /wechat-one-tap-login/);
    assert.match(profileJson, /WechatOneTapLogin/);
    assert.match(profileWxml, /wechat-one-tap-login/);
  });
}
