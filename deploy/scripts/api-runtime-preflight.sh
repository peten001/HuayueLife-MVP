#!/usr/bin/env bash

set -euo pipefail

readonly API_ROOT='/opt/HuayueLife-MVP/apps/api'
readonly API_ENTRYPOINT='/opt/HuayueLife-MVP/apps/api/dist/src/main.js'
readonly UPLOADS_ROOT='/opt/HuayueLife-MVP/apps/api/uploads'
readonly PRODUCT_UPLOADS_ROOT='/opt/HuayueLife-MVP/apps/api/uploads/products'

require_directory() {
  local target="$1"
  if [[ ! -d "$target" ]]; then
    printf 'BLOCKED: required directory is missing: %s\n' "$target" >&2
    exit 1
  fi
}

require_file() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    printf 'BLOCKED: required file is missing: %s\n' "$target" >&2
    exit 1
  fi
}

require_directory "$API_ROOT"
require_file "$API_ENTRYPOINT"
require_directory "$UPLOADS_ROOT"
require_directory "$PRODUCT_UPLOADS_ROOT"

printf 'PASS: canonical API runtime and protected uploads paths are present.\n'
