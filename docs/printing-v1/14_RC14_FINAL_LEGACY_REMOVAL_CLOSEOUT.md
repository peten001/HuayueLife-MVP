# RC14 Final Legacy Removal Closeout

## Final production invariant

There is exactly one production business-receipt path:

```text
Server Canonical
→ Binary Print Artifact V1
→ exact length and SHA-256 verification
→ RAW USB / LAN / Windows spooler
→ minimal completion acknowledgement
```

`YQ_CANONICAL_RECEIPT_V1`, threshold `205`, and the RC14 1-dot text emboldening
remain unchanged. This cleanup changes transport/runtime reachability only; it
does not change layout, font tokens, settlement, or persisted data.

## Removed from current runtime

- Android production local business-receipt renderers and snapshot parsers.
- Windows production WPF business-receipt renderer fallback.
- Base64 receipt payload encoding/decoding and RC13 JSON capacity guard.
- Capability selection that silently routed non-Binary clients to a legacy path.

Non-Binary clients receive `CLIENT_UPGRADE_REQUIRED`. Claim, active, and
printing responses contain metadata only. Receipt bytes are available only from
the authenticated `application/octet-stream` artifact endpoint.

## Diagnostic isolation

Android `PrinterDiagnosticRasterBuilder` and Windows
`DeviceDiagnosticPrintService` / `DiagnosticTestPrintRasterBuilder` exist only for operator-initiated printer
diagnostics. Neither is imported or reachable from the production `PrintJob`
executor.

## Operational safety

Historical `PrintJob`, `PrintAttempt`, audit logs, release packages, and
rollback releases are retained. No database migration is used.

```text
NO_HEAVY_FULL_TESTS_ON_LIVE_PRODUCTION_HOST
```

Full suites and large fixtures run on local, CI, build, or shadow systems. The
live PM2 host is limited to release verification, lightweight smoke checks, and
health checks. Production test print jobs must not be created during deployment.

## Physical acceptance boundary

- ID4: physical pass.
- ID11: physical pass.
- ID18: `USER_WAIVED_ACCEPTED`; this is not represented as a physical test pass.

The migration gate is `PASS_WITH_ID18_USER_WAIVER`.
