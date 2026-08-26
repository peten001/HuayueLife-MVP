# YunQiao Printing Single Source of Truth V1

Date: 2026-08-23

Last updated: 2026-08-26
Canonical template: `YQ_CANONICAL_RECEIPT_V1`
Render protocol: `ESC_POS_RASTER_V1`

## Decision

The immutable server-rendered ESC/POS payload is the only visual truth for a
canonical print job. Android and Windows validate and transport that payload;
they do not measure text, wrap dish names, rasterize, or add printer commands
for canonical jobs.

Legacy `PrintDocument` parsing remains only as a temporary compatibility path
for jobs created before a terminal reports the new capabilities. Any non-null,
unknown server render protocol is rejected instead of falling through to a
local renderer.

## Architecture before

```text
Receipt semantic model
        |
        v
Server PrintDocument V2/V3 snapshot
        |
        +-------------------------+
        |                         |
        v                         v
Android local Canvas         Windows WPF renderer
text measure + wrap          text measure + wrap
raster + ESC/POS             raster + RAW bytes
        |                         |
        v                         v
USB / LAN printer            RAW Spooler / TCP printer
```

The same semantic content could therefore produce different pixels because
the client renderer, font installation, renderer version, and printer profile
were not a single versioned artifact.

## Architecture after

```text
Receipt semantic model + merchant content preferences
        |
        v
Canonical server layout
Noto Sans SC 5.3.0 locked unicode-subset stack
grapheme-safe measure + wrap
        |
        v
576-dot 1-bit raster + ESC/POS commands
        |
        v
Immutable PrintJob payload + SHA-256 + protocol/profile metadata
        |
        +----------------------------+
        |                            |
        v                            v
Android SHA verify              Windows SHA verify
raw byte copy                   raw byte copy
        |                            |
        v                            v
USB / LAN write                RAW Spooler / TCP write
        |                            |
        +-------------+--------------+
                      v
Attempt receipt: expected SHA, actual SHA,
bytes written, actual transport, result
```

## Canonical 80 mm TABLE_BILL tokens

| Token | Value |
| --- | --- |
| Paper width | 80 mm |
| Raster width | 576 dots |
| Page margin | 30 dots per side |
| Content width | 516 dots |
| Inter-block gap | 4 dots |
| Font | `YunQiao Noto Sans SC` |
| Font package | `@fontsource-variable/noto-sans-sc@5.3.0` |
| Font license | OFL-1.1 |
| Threshold | 205 (global canonical value; baseline comparison 185) |
| Dish font weight | 500 effective Medium (deterministic Regular overprint) |
| Address / phone | `NORMAL`, effective Medium 500, centered wrap |
| Footer | `NORMAL`, effective Medium 500, 5-dot line gap |
| Table box weight | 24% |
| Table/title gap | 10 dots |
| Dish / quantity / amount | 72% / 10% / 18% |
| Column gap | 6 dots |
| Item row bottom gap | 8 dots |
| Vertical density | 203.2 dpi / 8 dots per mm |
| Footer/cut safety | 200 pure-white raster dots (25 mm) / half cut |

The Diguoju schema-3 receipt hierarchy is the visual baseline. The canonical
renderer locks the values above; a merchant template cannot override them.

## Header and wrapping contracts

- The structured Chinese merchant name is one centered `LARGE` bold line.
- The structured Vietnamese merchant name is a separate centered `LARGE`
  bold line below it. The renderer never guesses a language split from `/`,
  punctuation, or brackets.
- Missing languages are omitted and never duplicated as a filler line.
- Address and phone keep their independent merchant switches, but render in one
  centered wrapping `NORMAL` effective-Medium block. When both are visible the fixed separator is
  ` / `; when either is hidden there is no orphan separator.
- Every table-session information value uses an independent label/value row.
  The label width and 12-dot label/value gap are stable; long values, including
  order numbers, wrap inside the remaining width without ellipsis.
- A dish name is `LARGE`, medium weight 500, and wraps within the 72% dish
  column. The font family, package, size, column ratio, and wrap algorithm stay
  unchanged; quantity, amount, headings, totals, and footer keep their existing
  weights. The registered subset stack cannot safely expose numeric 500, so the
  server uses a deterministic second Regular pass as its effective Medium raster
  and guards it between the 400 and 700 black-pixel references.
- Vietnamese wraps at word boundaries when possible. Chinese, mixed text, and
  long unbroken tokens fall back to Unicode grapheme boundaries.
- Dish lines have no fixed line limit. Quantity and amount are emitted exactly
  once and remain in their own columns.
- Totals keep the accepted server semantics and order: original amount,
  commercial discount only when non-zero, rounding only when non-zero, then
  final amount received. A zero discount or zero rounding value never creates
  a blank row or changes the final amount.
- Each completed item group has an 8-dot bottom gap before its separator or the
  next block. The final `TABLE_BILL` payload carries 200 pure-white raster dots,
  calculated as `round(25 mm × 8 dots/mm)`, after the footer ink before half cut;
  it does not rely on printer-specific line-feed height. Other canonical print
  types retain their existing feed/cut behavior.

## Merchant preference allowlist

Canonical rendering preserves only these existing content semantics:

1. order number information (`showOrderNo`);
2. time information (`showTime`);
3. merchant address and merchant phone as their independent `showAddress` and
   `showPhone` switches;
4. footer visibility (`showFooter`) and the supported footer text;
5. the current `infoLineCount` derived from the order-number and time switches.

Legacy fields remain readable for compatibility, but canonical rendering
forces merchant name, table identity, notes, item amount, totals, typography,
paper profile, margins, columns, wrapping, raster threshold, feed, and cut.
Therefore `IGNORED_BY_CANONICAL_RENDERER = YES` for legacy layout/style fields
and for historical display switches outside the allowlist.

Merchant configuration is therefore content-only. It may decide whether the
existing order number, time, address, phone, and footer content is shown and may
provide the supported footer text. It cannot set font family or size, weight,
threshold, margins, columns, wrapping, layout version, rasterizer, feed, or cut.

For 80 mm TABLE_BILL, the order-number and time switches keep their existing
visibility semantics while each visible value now owns a stable row:

| order number | time | information blocks |
| --- | --- | ---: |
| off | off | 0 |
| on | off | 2 |
| off | on | 2 or 3 (close time is conditional) |
| on | on | 4 or 5 (close time is conditional) |

This is a layout change only. It does not add or reset a merchant preference.

## Immutable artifact contract

Every newly created `PrintJob` stores:

- `canonicalTemplateVersion`;
- `renderProtocol`;
- the final payload bytes;
- `renderedPayloadSha256`;
- `renderedPayloadByteLength`;
- `renderedPaperWidthMm`;
- `renderedWidthDots`;
- the existing immutable receipt snapshot and snapshot hash.

Retry, reclaim, reconnect, and duplicate completion paths reuse the stored
payload. They do not re-render it. A canonical success is accepted only when
the client-reported SHA matches the server SHA and `bytesWritten` equals the
stored payload byte length.

Each `PrintAttempt` records expected SHA, client-reported SHA, actual transport,
bytes written, and result. Valid actual transports are:

- `ANDROID_USB_ESCPOS`;
- `ANDROID_LAN_ESCPOS`;
- `WINDOWS_RAW_SPOOLER`;
- `WINDOWS_TCP_ESCPOS`.

## Bounded lease renewal response contract

Lease/renew endpoints MUST NOT return immutable rendered payload artifacts.
Large print artifacts are transferred only through the intended claim/job
payload path.

The Android rc13 client response safety limit is 1,048,576 characters. Lease
renewal responses therefore remain bounded and minimal: only the current
`leaseVersion` and `leaseExpiresAt` are returned. Regression tests require both
USB and LAN renewal responses to remain below 16 KiB and exclude
`renderedPayload`, `renderedPayloadBase64`, `receiptSnapshot`, `PrintDocument`,
and other large metadata.

## Bounded completion acknowledgement contract

Terminal success and failure report endpoints return only `jobId` and the
persisted job `status`. Completion retries remain idempotent, but their
acknowledgements never echo the immutable rendered payload, receipt snapshot,
or other job metadata. USB and LAN completion acknowledgements must remain
below 16 KiB so a completed local write can always be marked reported within
the Android rc13 response limit.

## Legacy JSON Transport Capacity

The RC13 JSON/Base64 transport and its capacity guard are removed from current
runtime source. Claim, active, and printing responses are metadata-only. The
artifact endpoint is the sole receipt-byte retrieval path and supports the
1/2/5/10 MiB test matrix without placing receipt content in control responses.
Non-Binary terminals receive `CLIENT_UPGRADE_REQUIRED` before job execution.

## Canonical darkness 205 evidence gate

Threshold 205 replaces 185 globally in the canonical server rasterizer. It does
not change font family, size, weight, line height, margins, columns, wrapping,
footer spacing, discount/rounding semantics, QR behavior, Android density, or
Windows transport. The 185 raster remains an offline comparison artifact only.

The locked fixtures prove that 185 and 205 have identical width, height, and
ESC/POS payload byte length while their pixel SHA differs. The offline evidence
set is `185.png`, `205.png`, and `diff.png`; visual review covers Chinese,
Vietnamese diacritics, address/phone, long wrapped dish names, quantities,
amounts, discount, rounding, footer, horizontal rules, interior counters, and
white-space noise. Cross-platform pixel determinism remains a separate paused
task, so macOS and Linux golden SHA values are locked independently.

No production job, order, reprint, or device print is created by this rollout.
Physical-paper readability is `WAITING_USER`; code, Linux, API health, and
natural-traffic evidence must not be presented as paper proof.

## Client capability and production gate

Production clients report:

- `SERVER_ESC_POS_PAYLOAD_V1 = true`;
- `RAW_PAYLOAD_PASSTHROUGH = true`;
- `BINARY_PRINT_ARTIFACT_V1 = true`.

The production claim and payload endpoints require
`BINARY_PRINT_ARTIFACT_V1` and reject unsupported terminals with
`CLIENT_UPGRADE_REQUIRED`.
The unauthenticated legacy merchant-session connector is rejected with the
same explicit upgrade error; production local printing requires a paired
terminal identity.
They also validate the immutable template, protocol, bytes, length, and SHA
before a job can be claimed or returned. A missing or incomplete server
artifact is rejected with `CANONICAL_PRINT_PAYLOAD_REQUIRED`; it is never sent
to an Android `PrintDocumentV2Renderer` or Windows `WpfReceiptRenderer`.

Legacy business renderer, Base64 decoder, and JSON payload compatibility source
are absent from the current Android and Windows runtimes. Diagnostic printer
test raster builders are explicitly named and isolated from `PrintJob`
execution. Android and Windows are transport-only in production.

Capability names are normalized case-insensitively on write and always stored
as the canonical keys above. Historical Windows acronym casing remains readable
for compatibility. The database platform enum is a compatibility identity and
does not contain `WINDOWS`; authenticated heartbeat capability truth is exposed
as `reportedPlatform = WINDOWS` while the stored identity remains `ANDROID`.

No production print job or physical test ticket may be created as part of this
software rollout without separate explicit permission.

## Print type audit

The current production enum contains only `ORDER_CUSTOMER` and `TABLE_BILL`.
Both are converted by the API into an immutable server payload. Kitchen-mode
content is also laid out on the server before transport. There is no current
`BUSINESS_DAY_SUMMARY` print-job receipt type; business-day, settlement,
payment, discount, rounding, and analytics behavior are outside this change.

Cloud printer integrations remain server-executed. They do not make an Android
or Windows client a layout authority.

## Production closeout evidence — 2026-08-25

`CURRENT_ACTIVE_PRINT_TERMINAL` requires an enabled, non-deleted bound printer,
an active non-revoked terminal, recent heartbeat/connection evidence, and real
recent PrintAttempt activity. The final inventory contains three terminals:

| merchant | terminal | reported platform | installed client | printer |
| --- | ---: | --- | --- | ---: |
| 4 农品香-湘菜馆 | 31 | ANDROID | 2.0.0-rc13 | 39 |
| 11 地锅居 | 30 | ANDROID | 2.0.0-rc13 | 38 |
| 18 川湘菜馆 | 35 | WINDOWS | Windows 1.1.0 compatibility code 101 | 43 |

All three have verified `ESC_POS_RASTER_V1` attempts with equal server/client
SHA and full non-zero byte writes. Across the complete recorded history of
these current terminals there are 586 successful legacy attempts before their
first verified canonical cutover and zero after it. At the final
2026-08-25 11:21 UTC audit, the rolling seven-day window contains 233 legacy
successes; all are pre-upgrade history and zero are post-upgrade regressions.

The remaining 20 terminal registrations are historical stale inventory: 19
have no current printer binding and one is bound only to a disabled printer.
They are retained for audit history and do not participate in the production
canonical gate.

Both current receipt types, `TABLE_BILL` and `ORDER_CUSTOMER`, have verified
production server payload attempts after cutover. New merchants do not clone a
private visual template; printers store only paper/hardware/connection data,
terminals store identity/binding/capability data, and every new PrintJob stores
the same server canonical artifact contract.

## Rollback

- Repoint API and Merchant Admin to their recorded previous releases.
- Keep the additive nullable payload/attempt columns; application rollback does
  not require destructive reverse DDL.
- Keep the production database backup taken before migration.
- Reinstall the recorded previous Android or Windows release if a client
  rollback is needed.
- Do not requeue an uncertain attempt or create a test print during rollback.
