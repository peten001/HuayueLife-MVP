#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <release-directory>\n' "$0" >&2
  exit 64
fi

readonly RELEASE_ROOT="$(cd "$1" && pwd)"
readonly API_ROOT="$RELEASE_ROOT/apps/api"
readonly ENTRYPOINT="$API_ROOT/dist/src/main.js"

for required in \
  "$ENTRYPOINT" \
  "$API_ROOT/package.json" \
  "$API_ROOT/node_modules" \
  "$API_ROOT/node_modules/@prisma/client" \
  "$RELEASE_ROOT/package.json" \
  "$RELEASE_ROOT/pnpm-workspace.yaml" \
  "$RELEASE_ROOT/pnpm-lock.yaml" \
  "$RELEASE_ROOT/deploy/scripts/shadow-api-runtime-release.sh" \
  "$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"; do
  if [[ ! -e "$required" ]]; then
    printf 'BLOCKED: incomplete API runtime release, missing %s\n' "$required" >&2
    exit 1
  fi
done

if ! grep -qx 'platform=Linux' "$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"; then
  printf 'BLOCKED: candidate lacks Linux-native dependency attestation\n' >&2
  exit 1
fi

if ! grep -q 'deploy --prod' "$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"; then
  printf 'BLOCKED: candidate lacks pnpm production deployment attestation\n' >&2
  exit 1
fi

if ! grep -q '^prisma_target=' "$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"; then
  printf 'BLOCKED: candidate lacks Linux-generated Prisma Client provenance\n' >&2
  exit 1
fi

if find "$RELEASE_ROOT" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) -print -quit | grep -q .; then
  printf 'BLOCKED: release contains a prohibited secret/configuration file\n' >&2
  exit 1
fi

broken_link="$(find "$RELEASE_ROOT" -xtype l -print -quit)"
if [[ -n "$broken_link" ]]; then
  printf 'BLOCKED: candidate has a broken symlink: %s\n' "$broken_link" >&2
  exit 1
fi

while IFS= read -r -d '' link_path; do
  resolved_link="$(readlink -f "$link_path")"
  case "$resolved_link" in
    "$RELEASE_ROOT"/*) ;;
    *)
      printf 'BLOCKED: candidate symlink escapes release: %s -> %s\n' "$link_path" "$resolved_link" >&2
      exit 1
      ;;
  esac
done < <(find "$RELEASE_ROOT" -type l -print0)

if find "$RELEASE_ROOT" -type f -name '*.node' -print0 | xargs -0 -r file | grep -E 'Mach-O|Apple' >/dev/null; then
  printf 'BLOCKED: macOS native binary detected in Linux candidate\n' >&2
  exit 1
fi

if find "$RELEASE_ROOT" -type f -name '*.node' -print0 | xargs -0 -r file | grep -q . && \
  ! find "$RELEASE_ROOT" -type f -name '*.node' -print0 | xargs -0 -r file | grep -q 'ELF'; then
  printf 'BLOCKED: Linux candidate native modules are not ELF binaries\n' >&2
  exit 1
fi

node --check "$ENTRYPOINT"

export RELEASE_ROOT API_ROOT
node <<'NODE'
const { createRequire } = require('node:module');
const path = require('node:path');

const releaseRoot = process.env.RELEASE_ROOT;
const apiRoot = process.env.API_ROOT;
const candidateRequire = createRequire(path.join(apiRoot, 'package.json'));

function requireFromCandidate(packageName) {
  const resolved = candidateRequire.resolve(packageName);
  if (!resolved.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new Error(`${packageName} resolved outside candidate: ${resolved}`);
  }
  const loaded = candidateRequire(packageName);
  if (!loaded) throw new Error(`${packageName} loaded an empty export`);
  console.log(`PASS: require(${JSON.stringify(packageName)}) -> ${resolved}`);
  return resolved;
}

const commonEntry = requireFromCandidate('@nestjs/common');
requireFromCandidate('@nestjs/core');
const prismaEntry = requireFromCandidate('@prisma/client');
const prismaGenerated = path.join(path.dirname(path.dirname(path.dirname(prismaEntry))), '.prisma', 'client', 'default.js');
require('node:fs').accessSync(prismaGenerated);
const { PrismaClient } = candidateRequire('@prisma/client');
const prismaClient = new PrismaClient();
if (!prismaClient) throw new Error('PrismaClient construction returned an empty value');
prismaClient.$disconnect();
console.log(`PASS: PrismaClient constructor -> ${prismaGenerated}`);

// uid is a nested NestJS runtime dependency. Resolve and execute it in the
// same CommonJS context that NestJS uses, rather than relying on global hoists.
{
  const require = createRequire(commonEntry);
  const uid = require('uid');
  if (!uid) throw new Error('uid loaded an empty export');
  const uidEntry = require.resolve('uid');
  if (!uidEntry.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new Error(`uid resolved outside candidate: ${uidEntry}`);
  }
  console.log(`PASS: require('uid') -> ${uidEntry}`);
}
NODE

printf 'PASS: API runtime release contract verified: %s\n' "$RELEASE_ROOT"
