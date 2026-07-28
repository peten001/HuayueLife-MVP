import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployRoot = resolve(currentDir, '..');
const require = createRequire(import.meta.url);
const ecosystem = require(resolve(deployRoot, 'pm2/ecosystem.config.cjs'));
const preflight = readFileSync(resolve(currentDir, 'api-runtime-preflight.sh'), 'utf8');
const cashierBoundary = readFileSync(
  resolve(deployRoot, 'cashier/RELEASE_BOUNDARY.md'),
  'utf8',
);

assert.equal(ecosystem.apps.length, 1);
assert.deepEqual(ecosystem.apps[0], {
  name: 'huayue-api',
  cwd: '/opt/HuayueLife-MVP/apps/api',
  script: '/opt/HuayueLife-MVP/apps/api/dist/src/main.js',
  interpreter: '/usr/bin/node',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  time: true,
  env: { NODE_ENV: 'production' },
});

for (const requiredPath of [
  '/opt/HuayueLife-MVP/apps/api',
  '/opt/HuayueLife-MVP/apps/api/dist/src/main.js',
  '/opt/HuayueLife-MVP/apps/api/uploads',
  '/opt/HuayueLife-MVP/apps/api/uploads/products',
]) {
  assert.ok(preflight.includes(requiredPath), `preflight must protect ${requiredPath}`);
}

assert.doesNotMatch(preflight, /git\s+clean\s+-fdx/);
assert.doesNotMatch(preflight, /rsync\b[^\n]*--delete/);
assert.match(cashierBoundary, /static-only/i);
assert.match(cashierBoundary, /must\s+not\s+manage\s+the\s+API\s+process/i);
assert.doesNotMatch(cashierBoundary, /pm2\s+(?:start|restart|reload|delete)/i);

const serializedConfig = JSON.stringify(ecosystem);
assert.doesNotMatch(
  serializedConfig,
  /DATABASE_URL|JWT_SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CLIENT_SECRET/i,
);

console.log('deployment runtime contract: PASS');
