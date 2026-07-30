#!/usr/bin/env bash

# Build a production API runtime candidate from a clean Linux source staging tree.
# This script deliberately refuses macOS and never accepts pre-existing node_modules.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-release-directory>\n' "$0" >&2
  exit 64
fi

readonly SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
readonly RELEASE_ROOT="$1"
readonly MARKER="$SOURCE_ROOT/.linux-native-runtime-install"

if [[ "$(uname -s)" != 'Linux' ]]; then
  printf 'BLOCKED: Linux-native runtime installation is required; refusing this host.\n' >&2
  exit 1
fi

if [[ -e "$RELEASE_ROOT" ]]; then
  printf 'BLOCKED: release destination already exists: %s\n' "$RELEASE_ROOT" >&2
  exit 1
fi

if [[ -e "$SOURCE_ROOT/node_modules" || -e "$SOURCE_ROOT/apps/api/node_modules" || -e "$MARKER" ]]; then
  printf 'BLOCKED: source staging tree is not clean; create a fresh source-only staging tree.\n' >&2
  exit 1
fi

for required in "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/pnpm-lock.yaml" "$SOURCE_ROOT/pnpm-workspace.yaml" "$SOURCE_ROOT/apps/api/package.json"; do
  [[ -f "$required" ]] || { printf 'BLOCKED: missing required source file: %s\n' "$required" >&2; exit 1; }
done

cd "$SOURCE_ROOT"
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @huayue-life/api prisma:generate
corepack pnpm --filter @huayue-life/api build

# Prune in the Linux staging tree only. The resulting tree is copied into the
# candidate and is never referenced by the candidate at runtime.
corepack pnpm install --frozen-lockfile --prod

{
  printf 'platform=Linux\n'
  printf 'node=%s\n' "$(node --version)"
  printf 'pnpm=%s\n' "$(corepack pnpm --version)"
  printf 'install=corepack pnpm install --frozen-lockfile --prod\n'
} >"$MARKER"

"$SOURCE_ROOT/deploy/scripts/assemble-api-runtime-release.sh" "$RELEASE_ROOT"
