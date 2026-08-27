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

## Post-closeout ID11 USB transient

On 2026-08-27, merchant 11 terminal 30 remained healthy while printer 38
temporarily disappeared from Android's USB enumeration. The server-observed
timeline in `Asia/Ho_Chi_Minh` was:

```text
OFFLINE_STARTED_AT = 2026-08-26 23:53:06 ICT
ONLINE_RECOVERED_AT = 2026-08-27 00:09:18 ICT
OFFLINE_DURATION = 16m12s
ROOT_CAUSE = TRANSIENT_USB_REENUMERATION
```

Printer 38 reported `DISCONNECTED / USB_DEVICE_NOT_FOUND` on the normal status
cadence, and every status request continued to return HTTP 201. Terminal 30
heartbeats remained healthy, so this was not a terminal outage, status TTL
flap, status-report delay, or server refresh delay. The USB status reporting,
heartbeat, binding, and readiness source was unchanged by the RC14 cleanup;
this incident is not a cleanup regression.

After the USB device reappeared, recovery Job 1230 / Attempt 1167 completed via
`ANDROID_USB_ESCPOS`. Expected SHA, actual SHA, and the persisted server SHA
were equal, and `bytesWritten` exactly matched the persisted payload length of
22,552 bytes. A later natural rc14 print, Job 1231 / Attempt 1168, also
succeeded with matching SHA and all 74,464 bytes written.

No code fix, client reinstall, rc15 installation, or production test print is
required for this isolated recovered event. Open a dedicated Android USB
attach/detach investigation only if the incident repeats multiple times in one
day or has sustained business impact.

```text
RC14_PRINTING_FINAL_CLOSED_NOT_REOPENED = YES
```

## Final compatibility gate

Production print eligibility is capability-only. Claim, artifact retrieval,
and attempt completion require `BINARY_PRINT_ARTIFACT_V1 = true`; they do not
reject a terminal by client version, version name, or version code. Historical
PrintDocument schema selection still reads a version while constructing a
server-side snapshot, but it is not a Binary transport eligibility gate.

Therefore Android `2.0.0-rc14` and Windows `1.2.0` compatibility code 102 remain
eligible when they report the Binary capability. A client without the
capability receives `CLIENT_UPGRADE_REQUIRED`; the removed RC12 local renderer,
RC13 Base64/JSON transport, and silent fallback must not be restored.

```text
SERVER_COMPATIBILITY_GATE = CAPABILITY_ONLY
VERSION_BASED_PRINT_REJECTION = NONE
RC14_CONTINUES_TO_PRINT = PASS
WINDOWS_1_2_0_CONTINUES_TO_PRINT = PASS
RC15_INSTALL_REQUIRED_NOW = NO
WINDOWS_1_2_1_INSTALL_REQUIRED_NOW = NO
```
