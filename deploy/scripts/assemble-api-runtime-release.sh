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
readonly SOURCE_COMMIT="${SOURCE_COMMIT:-}"

if [[ "$(uname -s)" != 'Linux' ]]; then
  printf 'BLOCKED: API runtime releases may only be assembled on Linux; refusing this host.\n' >&2
  exit 1
fi

if [[ -e "$RELEASE_ROOT" ]]; then
  printf 'BLOCKED: release destination already exists: %s\n' "$RELEASE_ROOT" >&2
  exit 1
fi

if [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'BLOCKED: SOURCE_COMMIT must be the exact 40-character source revision.\n' >&2
  exit 1
fi

for required in \
  "$API_SOURCE/dist/src/main.js" \
  "$API_SOURCE/package.json" \
  "$SOURCE_ROOT/package.json" \
  "$SOURCE_ROOT/pnpm-workspace.yaml" \
  "$SOURCE_ROOT/pnpm-lock.yaml" \
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

mkdir -p "$RELEASE_ROOT/deploy/scripts"
cp -a "$SOURCE_ROOT/package.json" "$RELEASE_ROOT/package.json"
cp -a "$SOURCE_ROOT/pnpm-workspace.yaml" "$RELEASE_ROOT/pnpm-workspace.yaml"
cp -a "$SOURCE_ROOT/pnpm-lock.yaml" "$RELEASE_ROOT/pnpm-lock.yaml"

# pnpm deploy creates an API-only production dependency closure. It cannot
# retain links to another workspace, staging, an old release, or macOS.
corepack pnpm --dir "$SOURCE_ROOT" --filter @huayue-life/api deploy --prod "$API_RELEASE"

# pnpm deploy leaves one workspace-self convenience link under .pnpm. The
# release already is that package, so this link is not a runtime dependency and
# must not point back to the disposable staging tree.
readonly WORKSPACE_SELF_LINK="$API_RELEASE/node_modules/.pnpm/node_modules/@huayue-life/api"
if [[ -L "$WORKSPACE_SELF_LINK" ]]; then
  workspace_self_target="$(readlink -f "$WORKSPACE_SELF_LINK")"
  if [[ "$workspace_self_target" != "$API_SOURCE" ]]; then
    printf 'BLOCKED: unexpected workspace self link: %s -> %s\n' "$WORKSPACE_SELF_LINK" "$workspace_self_target" >&2
    exit 1
  fi
  rm -f -- "$WORKSPACE_SELF_LINK"
fi

# A deployed package may include tracked examples. Runtime candidates carry no
# configuration or credentials: production configuration stays at the canonical
# API path and is injected only at launch.
while IFS= read -r -d '' prohibited_file; do
  rm -f -- "$prohibited_file"
done < <(find "$API_RELEASE" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) -print0)

cp -a "$SOURCE_ROOT/deploy/scripts/verify-api-runtime-release.sh" "$RELEASE_ROOT/deploy/scripts/verify-api-runtime-release.sh"
cp -a "$SOURCE_ROOT/deploy/scripts/shadow-api-runtime-release.sh" "$RELEASE_ROOT/deploy/scripts/shadow-api-runtime-release.sh"

# Keep runtime provenance with the candidate, but never copy .env or credentials.
{
  printf 'source_commit=%s\n' "$SOURCE_COMMIT"
  cat "$LINUX_INSTALL_MARKER"
} >"$RELEASE_ROOT/RUNTIME_RELEASE_MANIFEST.txt"

"$RELEASE_ROOT/deploy/scripts/verify-api-runtime-release.sh" "$RELEASE_ROOT"
printf 'PASS: Linux-native, pnpm-deployed self-contained API runtime release assembled at %s\n' "$RELEASE_ROOT"
