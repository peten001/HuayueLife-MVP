#!/usr/bin/env bash
set -euo pipefail

canonical_root="/Users/peter/Desktop/HuayueLife-MVP"
canonical_miniapp_root="${canonical_root}/apps/miniapp"

repo_root="$(git rev-parse --show-toplevel)"
current_path="$(pwd -P)"

if [[ "$repo_root" != "$canonical_root" ]]; then
  echo "MINIAPP_CANONICAL_WORKSPACE=FAIL repo_root=${repo_root}"
  exit 1
fi

if [[ "$current_path" != "$canonical_root" && "$current_path" != "$canonical_miniapp_root" && "$current_path" != "${canonical_miniapp_root}/"* ]]; then
  echo "MINIAPP_CANONICAL_WORKSPACE=FAIL cwd=${current_path}"
  exit 1
fi

case "$current_path" in
  *-release|*-release/*|*-validation|*-validation/*|*-experience|*-experience/*)
    echo "MINIAPP_CANONICAL_WORKSPACE=FAIL forbidden_path=${current_path}"
    exit 1
    ;;
esac

echo "MINIAPP_CANONICAL_WORKSPACE=PASS"
