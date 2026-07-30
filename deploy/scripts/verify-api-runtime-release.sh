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
  "$RELEASE_ROOT/package.json" \
  "$RELEASE_ROOT/pnpm-workspace.yaml" \
  "$RELEASE_ROOT/pnpm-lock.yaml" \
  "$RELEASE_ROOT/node_modules"; do
  if [[ ! -e "$required" ]]; then
    printf 'BLOCKED: incomplete API runtime release, missing %s\n' "$required" >&2
    exit 1
  fi
done

if find "$RELEASE_ROOT" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) -print -quit | grep -q .; then
  printf 'BLOCKED: release contains a prohibited secret/configuration file\n' >&2
  exit 1
fi

node --check "$ENTRYPOINT"

for package_name in '@nestjs/common' '@nestjs/core' '@prisma/client'; do
  resolved_path="$(cd "$API_ROOT" && node -e "process.stdout.write(require.resolve('$package_name'))")"
  case "$resolved_path" in
    "$RELEASE_ROOT"/*) printf 'PASS: %s -> %s\n' "$package_name" "$resolved_path" ;;
    *)
      printf 'BLOCKED: %s resolved outside the candidate release: %s\n' "$package_name" "$resolved_path" >&2
      exit 1
      ;;
  esac
done

printf 'PASS: API runtime release contract verified: %s\n' "$RELEASE_ROOT"
