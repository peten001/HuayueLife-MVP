#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <cashier-release-directory> <cashier-url>\n' "$0" >&2
  exit 64
fi

readonly RELEASE_ROOT="$1"
readonly CASHIER_URL="${2%/}/"
readonly LOCAL_INDEX="$RELEASE_ROOT/index.html"

if [[ ! -d "$RELEASE_ROOT" ]]; then
  printf 'BLOCKED: Cashier release directory is missing: %s\n' "$RELEASE_ROOT" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_INDEX" ]]; then
  printf 'BLOCKED: Cashier release is missing index.html: %s\n' "$LOCAL_INDEX" >&2
  exit 1
fi

if [[ ! -d "$RELEASE_ROOT/assets" ]]; then
  printf 'BLOCKED: Cashier release is missing assets directory: %s\n' "$RELEASE_ROOT/assets" >&2
  exit 1
fi

hash_file() {
  local target="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
    return
  fi

  printf 'BLOCKED: neither sha256sum nor shasum is available for release verification\n' >&2
  exit 1
}

# Keep the release check portable: macOS/local environments may have rg while
# the production host intentionally relies only on standard POSIX tooling.
matches_extended_regex() {
  local pattern="$1"
  local target="$2"

  if command -v rg >/dev/null 2>&1; then
    rg --quiet --ignore-case -- "$pattern" "$target"
  else
    grep -Eqi -- "$pattern" "$target"
  fi
}

readonly TEMP_ROOT="$(mktemp -d)"
readonly RESPONSE_HEADERS="$TEMP_ROOT/headers"
readonly RESPONSE_BODY="$TEMP_ROOT/body"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT

curl \
  --fail \
  --silent \
  --show-error \
  --max-time 15 \
  --dump-header "$RESPONSE_HEADERS" \
  --output "$RESPONSE_BODY" \
  "$CASHIER_URL"

if ! matches_extended_regex '^HTTP/[0-9.]+ 200([[:space:]]|$)' "$RESPONSE_HEADERS"; then
  printf 'BLOCKED: Cashier release verification expected HTTP 200 from %s\n' "$CASHIER_URL" >&2
  exit 1
fi

if ! matches_extended_regex '^x-huayue-cashier:[[:space:]]*cashier-static[[:space:]]*$' "$RESPONSE_HEADERS"; then
  printf 'BLOCKED: Cashier static release marker is missing from %s\n' "$CASHIER_URL" >&2
  exit 1
fi

if matches_extended_regex '^cache-control:.*immutable' "$RESPONSE_HEADERS"; then
  printf 'BLOCKED: Cashier index.html must not be served as immutable\n' >&2
  exit 1
fi

readonly LOCAL_INDEX_SHA256="$(hash_file "$LOCAL_INDEX")"
readonly REMOTE_INDEX_SHA256="$(hash_file "$RESPONSE_BODY")"

if [[ "$LOCAL_INDEX_SHA256" != "$REMOTE_INDEX_SHA256" ]]; then
  printf 'BLOCKED: public Cashier index.html does not match release artifact\n' >&2
  exit 1
fi

printf 'PASS: Cashier static release verified: %s (%s)\n' "$RELEASE_ROOT" "$CASHIER_URL"
