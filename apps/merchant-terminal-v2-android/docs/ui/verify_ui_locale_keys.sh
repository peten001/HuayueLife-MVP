#!/bin/zsh
set -eu

SCRIPT_DIR=${0:A:h}
MODULE_DIR=${SCRIPT_DIR:h:h}
RESOURCE_DIR="$MODULE_DIR/app/src/main/res"
CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT

for locale_dir in values values-en values-vi; do
  rg -o 'name="[^"]+"' "$RESOURCE_DIR/$locale_dir/strings.xml" | sort > "$CHECK_DIR/$locale_dir.keys"
done

for locale_dir in values-en values-vi; do
  if ! diff -u "$CHECK_DIR/values.keys" "$CHECK_DIR/$locale_dir.keys"; then
    print -u2 "UI locale keys differ: values vs $locale_dir"
    exit 1
  fi
done

print "UI locale key parity: PASS ($(wc -l < "$CHECK_DIR/values.keys" | tr -d ' ') keys in zh/en/vi)"
