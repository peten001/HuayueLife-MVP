import assert from 'node:assert/strict';
import {
  invalidateMerchantSessionCache,
  resolveCachedMerchantSession,
} from '../src/router/merchant-session-cache.ts';

invalidateMerchantSessionCache();
let calls = 0;
let release;
const pending = new Promise((resolve) => { release = resolve; });
const loader = () => {
  calls += 1;
  return pending;
};
const first = resolveCachedMerchantSession('token-a', loader);
const concurrent = resolveCachedMerchantSession('token-a', loader);
assert.equal(first, concurrent, 'concurrent route guards should share the same request');
release({ role: 'OWNER' });
await first;
await resolveCachedMerchantSession('token-a', loader);
assert.equal(calls, 1, 'internal navigation should reuse the session cache');

invalidateMerchantSessionCache();
await resolveCachedMerchantSession('token-a', async () => {
  calls += 1;
  return { role: 'OWNER' };
});
assert.equal(calls, 2, 'logout or 401 invalidation should require one new session fetch');

await resolveCachedMerchantSession('token-b', async () => {
  calls += 1;
  return { role: 'MANAGER' };
});
assert.equal(calls, 3, 'a changed token must never reuse another account session');

console.log('merchant session cache checks passed');
