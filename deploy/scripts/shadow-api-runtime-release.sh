#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: %s <release-directory> [loopback-port]\n' "$0" >&2
  exit 64
fi

readonly SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
readonly RELEASE_ROOT="$(cd "$1" && pwd)"
readonly API_ROOT="$RELEASE_ROOT/apps/api"
readonly SHADOW_PORT="${2:-3901}"
readonly LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/huayue-api-shadow.XXXXXX")"
readonly OUT_LOG="$LOG_DIR/shadow.out.log"
readonly ERR_LOG="$LOG_DIR/shadow.err.log"

"$SCRIPT_ROOT/verify-api-runtime-release.sh" "$RELEASE_ROOT"

port_is_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$SHADOW_PORT )" | grep -q ":$SHADOW_PORT"
  else
    lsof -nP -iTCP:"$SHADOW_PORT" -sTCP:LISTEN >/dev/null 2>&1
  fi
}

if port_is_listening; then
  printf 'BLOCKED: shadow loopback port already in use: %s\n' "$SHADOW_PORT" >&2
  exit 1
fi

start_ms="$(node -p 'Date.now()')"
pid=''
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  if [[ -n "$pid" ]]; then
    wait "$pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$API_ROOT"
API_SHADOW_DIAGNOSTIC_MODE=true \
CLOUD_PRINT_WORKER_ENABLED=false \
PRINTING_TASK_CENTER_ENABLED=false \
PRINTING_AUTO_CREATE_ENABLED=false \
PRINTING_EXECUTION_ENABLED=false \
LAN_PRINTING_ENABLED=false \
LEGACY_PRINTING_ENABLED=false \
HOST=127.0.0.1 \
PORT="$SHADOW_PORT" \
node dist/src/main.js >"$OUT_LOG" 2>"$ERR_LOG" &
pid=$!

listener_ms=''
health_ms=''
health_body=''
for _ in $(seq 1 60); do
  now_ms="$(node -p 'Date.now()')"
  if [[ -z "$listener_ms" ]] && port_is_listening; then
    listener_ms=$((now_ms - start_ms))
  fi
  if health_body="$(curl --fail --silent --show-error --max-time 1 "http://127.0.0.1:$SHADOW_PORT/api/v1/health" 2>/dev/null)"; then
    health_ms=$((now_ms - start_ms))
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

printf 'SHADOW_RELEASE_CWD=%s\n' "$API_ROOT"
printf 'SHADOW_EXEC=%s\n' "$API_ROOT/dist/src/main.js"
printf 'SHADOW_PORT=127.0.0.1:%s\n' "$SHADOW_PORT"
printf 'SHADOW_LISTENER_MS=%s\n' "${listener_ms:-UNREACHED}"
printf 'SHADOW_HEALTH_200_MS=%s\n' "${health_ms:-UNREACHED}"
printf 'SHADOW_LOG_DIR=%s\n' "$LOG_DIR"
if [[ -n "$health_ms" ]]; then
  printf 'SHADOW_HEALTH_BODY=%s\n' "$health_body"
  printf 'PASS: API shadow startup completed and will now stop.\n'
else
  printf 'BLOCKED: API shadow startup did not reach health.\n' >&2
  tail -n 80 "$OUT_LOG" >&2 || true
  tail -n 80 "$ERR_LOG" >&2 || true
  exit 1
fi
