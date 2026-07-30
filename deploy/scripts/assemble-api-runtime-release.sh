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
readonly LINUX_INSTALL_MARKER="$SOURCE_ROOT/.linux-native-runtime-install"

if [[ "$(uname -s)" != 'Linux' ]]; then
  printf 'BLOCKED: API runtime releases may only be assembled on Linux; refusing this host.\n' >&2
  exit 1
fi

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
  "$API_SOURCE/node_modules" \
  "$LINUX_INSTALL_MARKER"; do
  if [[ ! -e "$required" ]]; then
    printf 'BLOCKED: build or Linux runtime dependency is missing: %s\n' "$required" >&2
    exit 1
  fi
done

if ! grep -qx 'platform=Linux' "$LINUX_INSTALL_MARKER"; then
  printf 'BLOCKED: missing Linux-native installation attestation: %s\n' "$LINUX_INSTALL_MARKER" >&2
  exit 1
fi

mkdir -p "$API_RELEASE" "$RELEASE_ROOT/deploy/scripts"
cp -a "$API_SOURCE/dist" "$API_RELEASE/dist"
cp -a "$API_SOURCE/package.json" "$API_RELEASE/package.json"
cp -a "$SOURCE_ROOT/package.json" "$RELEASE_ROOT/package.json"
cp -a "$SOURCE_ROOT/pnpm-workspace.yaml" "$RELEASE_ROOT/pnpm-workspace.yaml"
cp -a "$SOURCE_ROOT/pnpm-lock.yaml" "$RELEASE_ROOT/pnpm-lock.yaml"
cp -a "$SOURCE_ROOT/node_modules" "$RELEASE_ROOT/node_modules"
cp -a "$API_SOURCE/node_modules" "$API_RELEASE/node_modules"
cp -a "$SOURCE_ROOT/deploy/scripts/verify-api-runtime-release.sh" "$RELEASE_ROOT/deploy/scripts/verify-api-runtime-release.sh"
cp -a "$SOURCE_ROOT/deploy/scripts/shadow-api-runtime-release.sh" "$RELEASE_ROOT/deploy/scripts/shadow-api-runtime-release.sh"

# Keep runtime provenance with the candidate, but never copy .env or credentials.
{
  printf 'source_commit=%s\n' "$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
  cat "$LINUX_INSTALL_MARKER"
} >"$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"

"$RELEASE_ROOT/deploy/scripts/verify-api-runtime-release.sh" "$RELEASE_ROOT"
printf 'PASS: Linux-native, self-contained API runtime release assembled at %s\n' "$RELEASE_ROOT"
