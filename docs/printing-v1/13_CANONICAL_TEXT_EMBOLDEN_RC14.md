# Canonical Text Embolden RC14

## Authority and invariant

`YQ_CANONICAL_RECEIPT_V1` remains the only production receipt renderer. RC14
adds the physically accepted B variant as a raster-stage text treatment:

```text
existing threshold-205 raster
OR
(1-dot stroked text mask AND NOT existing text mask)
```

The stroke is rendered only from the server layout's existing `TEXT`
operations. It does not change layout, text coordinates, wrapping, font family,
font size, font-weight tokens, paper width, receipt height, lines, boxes, images,
QR pixels, feed, or cut mode. Full-page dilation, blur, morphology, and client
layout changes are prohibited.

Locked values:

```text
paper width: 576 dots for MM80
threshold: 205
text outline: 1 device dot
render protocol: ESC_POS_RASTER_V1
transport: BINARY_PRINT_ARTIFACT_V1 for upgraded terminals
```

## Pixel contract

Linux renderer evidence must show all of the following before release:

```text
added text pixels > 0
removed black pixels = 0
non-text changed pixels = 0
line changed pixels = 0
box changed pixels = 0
image/QR changed pixels = 0
dimensions changed = false
text positions changed = false
line breaks changed = false
```

The final payload SHA is expected to change while byte length, dimensions,
layout fingerprint, threshold, feed, and cut structure remain fixed.

## Transport boundary

This visual change does not alter Binary Print Artifact V1. Upgraded clients
still claim metadata only, download `application/octet-stream`, verify exact
Content-Length and SHA-256, write the immutable bytes through RAW USB/LAN or
Windows spooler, and return minimal control acknowledgements. No client-side
receipt rendering is part of the canonical path.

## Rollout and cleanup gate

Deploy the server visual change without proactive production test printing.
After deployment, merchants 4, 11, and 18 each require a fresh Binary print and
explicit user acceptance of the physical paper. Logs, SHA equality, and
`bytesWritten` do not replace paper acceptance.

Until all three post-deployment physical tickets are accepted:

```text
FINAL = WAITING_THREE_MERCHANT_PHYSICAL_VALIDATION
STOP_BEFORE_LEGACY_REMOVAL
```

RC12 local-render runtime and RC13 Base64/JSON transport cleanup are a separate
gated phase. They must not be removed, disabled, or made unreachable before the
three-merchant gate passes.
