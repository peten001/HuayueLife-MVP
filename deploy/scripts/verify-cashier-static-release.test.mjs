import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const currentDir = dirname(fileURLToPath(import.meta.url));
const verifier = resolve(currentDir, 'verify-cashier-static-release.sh');
const tempRoot = mkdtempSync(resolve(tmpdir(), 'cashier-release-verifier-'));
const releaseRoot = resolve(tempRoot, 'release');
const localIndex = '<!doctype html><title>cashier release</title>';

function runVerifier({ path }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('/bin/bash', [verifier, path, baseUrl], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

mkdirSync(resolve(releaseRoot, 'assets'), { recursive: true });
writeFileSync(resolve(releaseRoot, 'index.html'), localIndex);

const server = createServer((request, response) => {
  assert.equal(request.url, '/');
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/html; charset=utf-8',
    'X-Huayue-Cashier': 'cashier-static',
  });
  response.end(localIndex);
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const rgPath = process.env.PATH;
  const withRg = await runVerifier({ path: releaseRoot });
  assert.equal(withRg.code, 0, withRg.stderr);
  assert.match(withRg.stdout, /PASS: Cashier static release verified/);

  const withoutRg = await new Promise((resolveRun, rejectRun) => {
    const child = spawn('/bin/bash', [verifier, releaseRoot, baseUrl], {
      env: { ...process.env, PATH: '/usr/bin:/bin:/sbin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stderr }));
  });
  assert.equal(withoutRg.code, 0, withoutRg.stderr);
  assert.ok(rgPath, 'test runner requires a PATH');

  const mismatchRoot = resolve(tempRoot, 'mismatch');
  mkdirSync(resolve(mismatchRoot, 'assets'), { recursive: true });
  writeFileSync(resolve(mismatchRoot, 'index.html'), '<!doctype html><title>different release</title>');
  const mismatch = await runVerifier({ path: mismatchRoot });
  assert.notEqual(mismatch.code, 0, 'content mismatch must fail release verification');
  assert.match(mismatch.stderr, /does not match release artifact/);
} finally {
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('cashier static release verifier: PASS');
