import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMerchantFavoriteGate } from '../src/utils/merchant-favorite-gate.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(scriptDir, '..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function unauthorized() {
  const error = new Error('Unauthorized');
  error.statusCode = 401;
  return error;
}

function createHarness({
  authenticated = false,
  requestLogin = async () => 'success',
  persistFavorite = async () => undefined,
  isContextCurrent = () => true,
} = {}) {
  let loggedIn = authenticated;
  const loginCalls = [];
  const persistCalls = [];
  const stateChanges = [];
  let favoriteFailures = 0;

  const gate = createMerchantFavoriteGate({
    isAuthenticated: () => loggedIn,
    requestLogin: async (forceLogin) => {
      loginCalls.push(forceLogin);
      const outcome = await requestLogin(forceLogin);
      if (outcome === 'success') loggedIn = true;
      return outcome;
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
    loginCalls,
    persistCalls,
    stateChanges,
    get favoriteFailures() {
      return favoriteFailures;
    },
  };
}

test('1 unauthenticated click does not persist before login resolves', async () => {
  const login = deferred();
  const harness = createHarness({ requestLogin: () => login.promise });
  const action = harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(harness.persistCalls.length, 0);
  login.resolve('cancelled');
  await action;
  assert.equal(harness.persistCalls.length, 0);
});

test('2 unauthenticated click opens the existing login flow', async () => {
  const harness = createHarness({ requestLogin: async () => 'cancelled' });
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.deepEqual(harness.loginCalls, [false]);
});

test('3 login success automatically persists exactly once', async () => {
  const harness = createHarness();
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.deepEqual(harness.persistCalls, [{ merchantId: '1', desiredState: true }]);
});

test('4 login success completes without a second favorite click', async () => {
  const harness = createHarness();
  const result = await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(result, 'completed');
  assert.deepEqual(harness.stateChanges, [true]);
});

test('5 favorite persistence success changes the heart state to saved', async () => {
  const harness = createHarness({ authenticated: true });
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.deepEqual(harness.stateChanges, [true]);
});

test('6 cancelling login clears the intent without persistence or state change', async () => {
  const harness = createHarness({ requestLogin: async () => 'cancelled' });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'cancelled',
  );
  assert.equal(harness.persistCalls.length, 0);
  assert.equal(harness.stateChanges.length, 0);
});

test('7 login failure does not persist or fake favorite state', async () => {
  const harness = createHarness({ requestLogin: async () => 'failed' });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'login-failed',
  );
  assert.equal(harness.persistCalls.length, 0);
  assert.equal(harness.stateChanges.length, 0);
});

test('8 logged-in favorite succeeds directly', async () => {
  const harness = createHarness({ authenticated: true });
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(harness.loginCalls.length, 0);
  assert.deepEqual(harness.persistCalls, [{ merchantId: '1', desiredState: true }]);
});

test('9 logged-in unfavorite preserves the click-time desired state', async () => {
  const harness = createHarness({ authenticated: true });
  await harness.gate.toggle({ merchantId: '1', currentState: true });
  assert.deepEqual(harness.persistCalls, [{ merchantId: '1', desiredState: false }]);
  assert.deepEqual(harness.stateChanges, [false]);
});

test('10 non-401 persistence failure does not open login or change state', async () => {
  const harness = createHarness({
    authenticated: true,
    persistFavorite: async () => {
      throw new Error('Storage unavailable');
    },
  });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'favorite-failed',
  );
  assert.equal(harness.loginCalls.length, 0);
  assert.equal(harness.stateChanges.length, 0);
  assert.equal(harness.favoriteFailures, 1);
});

test('11 a 401 persistence error forces the existing login flow', async () => {
  let calls = 0;
  const harness = createHarness({
    authenticated: true,
    persistFavorite: async () => {
      calls += 1;
      if (calls === 1) throw unauthorized();
    },
  });
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.deepEqual(harness.loginCalls, [true]);
});

test('12 a 401 retries persistence once after successful login', async () => {
  let calls = 0;
  const harness = createHarness({
    authenticated: true,
    persistFavorite: async () => {
      calls += 1;
      if (calls === 1) throw unauthorized();
    },
  });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'completed',
  );
  assert.equal(harness.persistCalls.length, 2);
  assert.deepEqual(harness.stateChanges, [true]);
});

test('13 a second 401 stops without another login loop', async () => {
  const harness = createHarness({
    authenticated: true,
    persistFavorite: async () => {
      throw unauthorized();
    },
  });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'favorite-failed',
  );
  assert.equal(harness.persistCalls.length, 2);
  assert.deepEqual(harness.loginCalls, [true]);
  assert.equal(harness.stateChanges.length, 0);
});

test('14 double tap while login is open keeps one pending intent', async () => {
  const login = deferred();
  const harness = createHarness({ requestLogin: () => login.promise });
  const first = harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'ignored',
  );
  assert.equal(harness.loginCalls.length, 1);
  login.resolve('success');
  await first;
  assert.equal(harness.persistCalls.length, 1);
});

test('15 duplicate login-success continuation cannot replay the consumed intent', async () => {
  const harness = createHarness();
  await harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(await harness.gate.continueAfterLogin(), 'ignored');
  assert.equal(await harness.gate.continueAfterLogin(), 'ignored');
  assert.equal(harness.persistCalls.length, 1);
});

test('16 double tap while persistence is pending starts one write', async () => {
  const persistence = deferred();
  const harness = createHarness({
    authenticated: true,
    persistFavorite: () => persistence.promise,
  });
  const first = harness.gate.toggle({ merchantId: '1', currentState: false });
  assert.equal(
    await harness.gate.toggle({ merchantId: '1', currentState: false }),
    'ignored',
  );
  assert.equal(harness.persistCalls.length, 1);
  persistence.resolve();
  await first;
  assert.equal(harness.persistCalls.length, 1);
});

test('17 merchant context change prevents the old pending action', async () => {
  const login = deferred();
  let currentMerchantId = 'A';
  const harness = createHarness({
    requestLogin: () => login.promise,
    isContextCurrent: (merchantId) => merchantId === currentMerchantId,
  });
  const action = harness.gate.toggle({ merchantId: 'A', currentState: false });
  currentMerchantId = 'B';
  login.resolve('success');
  assert.equal(await action, 'context-changed');
  assert.equal(harness.persistCalls.length, 0);
});

test('18 pending desired state is snapshotted at click time', async () => {
  const login = deferred();
  const harness = createHarness({ requestLogin: () => login.promise });
  const action = harness.gate.toggle({ merchantId: '1', currentState: true });
  login.resolve('success');
  await action;
  assert.deepEqual(harness.persistCalls, [{ merchantId: '1', desiredState: false }]);
});

test('19 favorite icon source and selected-state binding are unchanged', () => {
  const detail = fs.readFileSync(
    path.join(miniappRoot, 'src/pages/merchant/detail.vue'),
    'utf8',
  );
  assert.match(detail, /heartActive: '\/static\/merchant-detail-icons\/heart-filled-warm\.png'/);
  assert.match(detail, /favoriteState \? uiIcons\.heartActive : uiIcons\.heartGreen/);
  assert.match(detail, /:aria-pressed="favoriteState"/);
});

test('20 sticky action and ordering layout remain unchanged', () => {
  const detail = fs.readFileSync(
    path.join(miniappRoot, 'src/pages/merchant/detail.vue'),
    'utf8',
  );
  assert.match(detail, /<view :class="\['sticky-actions', \{ 'has-order-ctas': hasBottomCta \}\]">/);
  assert.match(detail, /<view v-if="hasBottomCta" class="sticky-orders">/);
  assert.match(detail, /\.sticky-orders \.pickup \{[\s\S]*background: var\(--brand-soft\);/);
  assert.match(detail, /\.sticky-orders \.delivery \{[\s\S]*background: var\(--brand-deep\);/);
});

test('source wiring opens the shared real one-click login component', () => {
  const detail = fs.readFileSync(
    path.join(miniappRoot, 'src/pages/merchant/detail.vue'),
    'utf8',
  );
  const loginComponent = fs.readFileSync(
    path.join(miniappRoot, 'src/components/WechatOneTapLogin.vue'),
    'utf8',
  );
  assert.match(detail, /favoriteLoginUi\.value\?\.open\(\) \?\? 'failed'/);
  assert.doesNotMatch(detail, /requireLoginForAction\('favorite'/);
  assert.match(loginComponent, /class="wechat-login-button"/);
  assert.match(loginComponent, /await auth\.loginWithWechat\(\)/);
  assert.match(loginComponent, /defineExpose\(\{ open, close: cancel \}\)/);
});
