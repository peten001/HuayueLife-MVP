#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-release-directory>\n' "$0" >&2
  exit 64
fi

readonly SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
readonly RELEASE_ROOT="$1"
readonly API_SOURCE="$SOURCE_ROOT/apps/api"
readonly API_RELEASE="$RELEASE_ROOT/apps/api"

if [[ -e "$RELEASE_ROOT" ]]; then
  printf 'BLOCKED: release destination already exists: %s\n' "$RELEASE_ROOT" >&2
  exit 1
fi

for required in \
  "$API_SOURCE/dist/src/main.js" \
  "$API_SOURCE/package.json" \
  "$SOURCE_ROOT/package.json" \
  "$SOURCE_ROOT/pnpm-workspace.yaml" \
  "$SOURCE_ROOT/pnpm-lock.yaml" \
  "$SOURCE_ROOT/node_modules" \
  "$API_SOURCE/node_modules"; do
  if [[ ! -e "$required" ]]; then
    printf 'BLOCKED: build or runtime dependency is missing: %s\n' "$required" >&2
    exit 1
  fi
done

mkdir -p "$API_RELEASE"
cp -a "$API_SOURCE/dist" "$API_RELEASE/dist"
cp -a "$API_SOURCE/package.json" "$API_RELEASE/package.json"
cp -a "$SOURCE_ROOT/package.json" "$RELEASE_ROOT/package.json"
cp -a "$SOURCE_ROOT/pnpm-workspace.yaml" "$RELEASE_ROOT/pnpm-workspace.yaml"
cp -a "$SOURCE_ROOT/pnpm-lock.yaml" "$RELEASE_ROOT/pnpm-lock.yaml"

# pnpm's API-level links are relative to the workspace-level .pnpm store, so
# both layers must travel together. This deliberately avoids an implicit
# dependency on a parent checkout's node_modules.
cp -a "$SOURCE_ROOT/node_modules" "$RELEASE_ROOT/node_modules"
cp -a "$API_SOURCE/node_modules" "$API_RELEASE/node_modules"

"$SOURCE_ROOT/deploy/scripts/verify-api-runtime-release.sh" "$RELEASE_ROOT"
printf 'PASS: complete API runtime release assembled at %s\n' "$RELEASE_ROOT"
