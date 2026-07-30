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
const buildLinuxRuntime = readFileSync(resolve(currentDir, 'build-api-linux-runtime-release.sh'), 'utf8');
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
  '"$(uname -s)" != \'Linux\'',
  '"$API_SOURCE/dist/src/main.js"',
  '"$API_SOURCE/package.json"',
  '"$SOURCE_ROOT/pnpm-workspace.yaml"',
  '"$SOURCE_ROOT/pnpm-lock.yaml"',
  '"$LINUX_INSTALL_MARKER"',
  'readonly SOURCE_COMMIT="${SOURCE_COMMIT:-}"',
  'SOURCE_COMMIT must be the exact 40-character source revision',
  'corepack pnpm --dir "$SOURCE_ROOT" --filter @huayue-life/api deploy --prod "$API_RELEASE"',
  'readonly WORKSPACE_SELF_LINK="$API_RELEASE/node_modules/.pnpm/node_modules/@huayue-life/api"',
  'unexpected workspace self link',
  "-name '.env.*'",
  'rm -f -- "$prohibited_file"',
  'RUNTIME_RELEASE_MANIFEST.txt',
]) {
  assert.ok(assembleRuntime.includes(requiredSnippet), `runtime assembler missing: ${requiredSnippet}`);
}
assert.match(assembleRuntime, /verify-api-runtime-release\.sh/);
assert.match(buildLinuxRuntime, /corepack pnpm install --frozen-lockfile/);
assert.match(buildLinuxRuntime, /deploy --prod/);
assert.match(buildLinuxRuntime, /source staging tree is not clean/);
assert.match(buildLinuxRuntime, /Linux-native runtime installation is required/);
assert.match(buildLinuxRuntime, /SOURCE_COMMIT must be the exact 40-character source revision/);
for (const packageName of ['@nestjs/common', '@nestjs/core', '@prisma/client', 'uid']) {
  assert.match(verifyRuntime, new RegExp(packageName.replace('/', '\\/')));
}
assert.match(verifyRuntime, /resolved outside candidate/);
assert.match(verifyRuntime, /candidate symlink escapes release/);
assert.match(verifyRuntime, /Mach-O/);
assert.match(verifyRuntime, /require\('uid'\)/);
assert.match(verifyRuntime, /-name '\.env'/);
assert.match(shadowRuntime, /API_SHADOW_DIAGNOSTIC_MODE=true/);
assert.match(shadowRuntime, /HOST=127\.0\.0\.1/);
assert.match(shadowRuntime, /PRINTING_AUTO_CREATE_ENABLED=false/);
assert.match(shadowRuntime, /CLOUD_PRINT_WORKER_ENABLED=false/);
assert.match(shadowRuntime, /api\/v1\/health/);

console.log('deployment runtime contract: PASS');
