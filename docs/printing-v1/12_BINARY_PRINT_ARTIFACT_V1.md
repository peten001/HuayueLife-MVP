# Binary Print Artifact V1

## Authority and invariant

`YQ_CANONICAL_RECEIPT_V1` remains the only receipt layout authority. The server
renders `ESC_POS_RASTER_V1` once, persists the immutable bytes on `PrintJob`, and
records their exact byte length and SHA-256. `BINARY_PRINT_ARTIFACT_V1` changes
only transport: it does not change the canonical renderer, threshold `205`, or
receipt bytes.

No database migration is required. The artifact source is the existing
`PrintJob.renderedPayload` together with `renderedPayloadByteLength`,
`renderedPayloadSha256`, and `renderProtocol`.

## Required terminal capability

A production terminal must report the exact boolean capability:

```json
{ "BINARY_PRINT_ARTIFACT_V1": true }
```

Active, claim, and printing responses contain a small
descriptor with `payloadTransport`, `payloadByteLength`, `payloadSha256`, and
`artifactPath`. They contain no Base64 payload, receipt snapshot, print
document, or semantic document.

Terminals without the capability receive `CLIENT_UPGRADE_REQUIRED`. There is no
Base64/JSON response and no client-side business receipt renderer fallback.

## Artifact contract

Authenticated terminals retrieve the claimed artifact from:

```text
GET /api/v1/terminal/jobs/:jobId/artifact
```

The response is the exact persisted ESC/POS bytes and has:

```text
Content-Type: application/octet-stream
Content-Length: <exact byte length>
Cache-Control: private, no-store
X-YunQiao-Payload-SHA256: <sha256>
X-YunQiao-Render-Protocol: ESC_POS_RASTER_V1
```

Authorization requires the active terminal, merchant, claimed job, live lease,
and current USB or LAN binding to agree. Authorization is decided when the
request starts; a lease expiring naturally while an authorized response is in
flight does not truncate that response.

The server rejects abnormal artifacts above 20 MiB. This is a corruption guard,
not the legacy JSON client limit.

## Client execution order

Android and Windows clients follow this order:

1. Stream to an app-private temporary file in 64 KiB chunks.
2. Verify response type, encoding, exact length, protocol, and incremental
   SHA-256.
3. Renew the lease if necessary.
4. Create or resume the existing print attempt only when printer I/O is about to
   start.
5. Stream the verified file as RAW bytes to USB, LAN TCP, or Windows spooler.
6. Delete the temporary file and send the existing minimal success/failure
   result.

Network and partial-download retries occur before `PrintAttempt` creation and
therefore cannot duplicate printer I/O. A length or SHA mismatch is never
printed and is reported without returning artifact content.

## Operations and rollback

Deploy the server and distribute the required client versions as one controlled
release. Do not install a client without an onsite operator able to confirm the
resulting paper unless the user has explicitly waived that physical check.

Structured download logs use only
`PRINT_ARTIFACT_DOWNLOAD_STARTED`, `PRINT_ARTIFACT_DOWNLOAD_COMPLETED`, and
`PRINT_ARTIFACT_DOWNLOAD_FAILED`, with job/terminal IDs, byte count, duration,
SHA status, and retry count. They never contain receipt bytes or Base64.

Rollback switches the API release and client package to the retained prior
artifacts after the queue and terminal versions are audited. Historical jobs,
attempts, logs, releases, and installation packages are retained; the current
runtime does not retain an executable legacy payload path.

Full suites and large fixtures run only on local, CI, build, or shadow systems.
`NO_HEAVY_FULL_TESTS_ON_LIVE_PRODUCTION_HOST` is mandatory: the live PM2 host
runs only release verification, lightweight smoke checks, and health checks.
