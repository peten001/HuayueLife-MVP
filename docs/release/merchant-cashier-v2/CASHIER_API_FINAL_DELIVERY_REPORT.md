# Cashier/API V2 Final Delivery Report

## Scope

This delivery contains only merchant Cashier V2, the merchant table-session checkout API,
10,000 VND tail-rounding, TABLE_BILL receipt totals, related routes/tests, the Prisma schema
change, and the formal acceptance scripts.

Android changes, generated APKs, Android blue-screen diagnostics, D2 safe mode, WebView A/B,
session-bridge follow-up, and Android printing-closure follow-up are intentionally excluded.

## Settlement contract

Table settlement rounds down by removing only the tail below 10,000 VND:

- 513,000 -> 510,000; rounding 3,000
- 511,000 -> 510,000; rounding 1,000
- 510,000 -> 510,000; rounding 0
- 509,500 -> 500,000; rounding 9,500

The API and Cashier preserve the original amount, rounding amount, and received amount.
Individual order records retain their original order total. Checkout status-log metadata links
each completed table order to the table-session settlement values. TABLE_BILL snapshots expose
the same totals for printing.

## Migration

Migration: `20260725000000_add_table_session_rounding`.

Production preparation order remains: take a verified backup; run `prisma migrate deploy` once;
verify the new `table_sessions` columns and API health; deploy the API; verify table checkout and
TABLE_BILL snapshots; deploy the Cashier; then run the read-only acceptance checks. No production
deployment was performed in this delivery.

## Verification

- Cashier lint, typecheck, unit tests, build: PASS
- Cashier V2 UI acceptance: PASS
- Cashier redacted real-API acceptance: PASS
- API typecheck, unit tests, build: PASS
- `git diff --check`: PASS

## Commit boundary

The staged boundary must contain no path under `apps/merchant-terminal-android`, no APK under
`app/build/outputs/apk`, no `docs/ui-review` screenshot directory, no old workflow/handover
screenshot script, and no unrelated historical material.
