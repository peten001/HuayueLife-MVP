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
const assembleRuntime = readFileSync(resolve(currentDir, 'assemble-api-runtime-release.sh'), 'utf8');
const verifyRuntime = readFileSync(resolve(currentDir, 'verify-api-runtime-release.sh'), 'utf8');
const shadowRuntime = readFileSync(resolve(currentDir, 'shadow-api-runtime-release.sh'), 'utf8');
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

for (const requiredSnippet of [
  'readonly API_SOURCE="$SOURCE_ROOT/apps/api"',
  '"$API_SOURCE/dist/src/main.js"',
  '"$API_SOURCE/package.json"',
  '"$SOURCE_ROOT/pnpm-workspace.yaml"',
  '"$SOURCE_ROOT/pnpm-lock.yaml"',
  'cp -a "$SOURCE_ROOT/node_modules" "$RELEASE_ROOT/node_modules"',
  'cp -a "$API_SOURCE/node_modules" "$API_RELEASE/node_modules"',
]) {
  assert.ok(assembleRuntime.includes(requiredSnippet), `runtime assembler missing: ${requiredSnippet}`);
}
assert.match(assembleRuntime, /verify-api-runtime-release\.sh/);
for (const packageName of ['@nestjs/common', '@nestjs/core', '@prisma/client']) {
  assert.match(verifyRuntime, new RegExp(packageName.replace('/', '\\/')));
}
assert.match(verifyRuntime, /resolved outside the candidate release/);
assert.match(verifyRuntime, /-name '\.env'/);
assert.match(shadowRuntime, /API_SHADOW_DIAGNOSTIC_MODE=true/);
assert.match(shadowRuntime, /HOST=127\.0\.0\.1/);
assert.match(shadowRuntime, /PRINTING_AUTO_CREATE_ENABLED=false/);
assert.match(shadowRuntime, /CLOUD_PRINT_WORKER_ENABLED=false/);
assert.match(shadowRuntime, /api\/v1\/health/);

console.log('deployment runtime contract: PASS');
