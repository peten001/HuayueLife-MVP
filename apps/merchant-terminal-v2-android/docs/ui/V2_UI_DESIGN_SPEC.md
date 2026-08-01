# YunQiao Merchant Terminal V2 UI reproduction specification

Status: implementation contract for screens 02–09. The individual PNG files in
`YUNQIAO_MERCHANT_TERMINAL_V2_FULL_EXECUTION_PACKAGE/UI_REFERENCE` are the sole visual authority.
Taste was used only to extract the visible hierarchy and measurements; Impeccable native guidance is
used only as a quality floor and final audit. Neither is permission to redesign the references.

## Baselines and scaling

- Strict baseline: SUNMI D2, 1366 × 768 px, landscape, 160 dpi.
- Reference images 01–10: 1672 × 941 px. Exact axes are `sx=1366/1672=0.816986` and
  `sy=768/941=0.816153`. Screenshot comparison resizes each reference directly to 1366 × 768;
  values are not silently normalized to one scale.
- D10 Pro: 1280 × 800, same information hierarchy with proportional free-space adjustment.
- Compact/P10: full-screen single-column native surface. Primary and secondary actions stay at the
  bottom; desktop panels must not be squeezed into unreadable columns.
- D2 native critical geometry tolerance: at most 4 physical pixels before the screen can pass visual
  review. Dynamic Web content may be masked; native content may not.

## Reference ownership and known contradictions

| Screen | Native comparison region in reference coordinates | D2 region | Rule |
|---|---:|---:|---|
| 02 | x246 y126 w1426 h815 | x201 y103 w1165 h665 | Page-specific inset; do not average with 03/09. |
| 03 | x237 y121 w1435 h820 | x194 y99 w1172 h669 | Page-specific inset. |
| 04 | modal x470 y126 w732 h689 | x384 y103 w598 h562 | Background is not an implementation target. |
| 05 | modal x342 y101 w987 h786 | x279 y82 w807 h642 | Modal only. |
| 06 | x328 y143 w1255 h775 | x268 y117 w1025 h632 | Main native panel only. |
| 07 | modal x336 y115 w1091 h810 | x275 y94 w891 h661 | Modal only. |
| 08 | modal x286 y114 w1289 h791 | x234 y93 w1053 h646 | Modal only. |
| 09 | x240 y125 w1432 h816 | x196 y102 w1170 h666 | Page-specific inset. |

Screen 04 visibly contains only USB and LAN, while the locked product requirement and screen 08 require
Classic Bluetooth. V2 therefore adds a third Bluetooth option using screen 04's own card grammar. This is
the only intentional D2 native-region divergence and must be called out in every diff report; literal
zero-diff is not a valid claim for screen 04.

The 04 background also shows old diagnostics/service controls. They are reference contamination, are
outside the modal comparison region, and must never be implemented. Screen 09's business state is a
read-only visual state with no click action; changes remain in Merchant Admin.

## Per-screen measured geometry at D2

- 02: service card `(227,203,1114,109)`, add action `(1162,333,179,49)`, printer rows at
  `(234,389/501/613,1107,106/105/104)`, test `(991,420,145,44)`, manage `(1158,420,152,44)`.
- 03: running card `(216,198,1128,109)`, state matrix `(216,322,1128,262)`, refresh/back actions
  `(216/486,607,248/227,48)`, information strip `(216,673,1128,69)`.
- 04: modal `(384,103,598,562)`, source option grammar `(419,269,528,133)`, icon tile `82 × 82`,
  primary action `(761,598,186,48)`. Required third transport uses the same grammar with adaptive
  vertical spacing rather than a different component.
- 05: modal `(279,82,807,642)`, discovery strip `(311,241,744,36)`, network rows at y326/405/483,
  helper strip `(311,565,744,56)`, bottom actions y642–643 and h48–50.
- 06: panel `(268,117,1025,632)`, summary `(321,224,921,102)`, result `(321,338,921,90)`, table
  `(321,437,921,202)`, actions y667 h46.
- 07: modal `(275,94,891,661)`, process `(297,180,846,123)`, device `(297,359,846,90)`, settings
  `(297,497,846,160)`, actions y676 h53.
- 08: modal `(234,93,1053,646)`, paired card `(277,268,435,87)`, nearby cards y422/519,
  settings `(790,269,449,245)`, helper `(790,530,449,54)`, actions y650 h54.
- 09: summary `(230,176,1109,170)`, details `(230,362,1109,379)`, read-only information strip
  `(256,569,1054,59)`, actions x256/614/975 y659 h54.

Reference controls whose visible height is below 48 dp keep the measured silhouette, while an invisible
parent hit target expands to at least 48 × 48 dp. This applies especially to back, test/manage, and compact
footer actions.

## Visual tokens

Colors remain screen-specific:

- 02: page `#F5F8F7`, mint `#E3FAED`, green `#009B62`, border `#E4E9ED`.
- 03: page `#F5F7F8`, green `#019560`, success border `#C3E9DA`, info `#F1F7FD`, info border `#C6DFFA`.
- 04: green `#0F7943`, selected `#EFF7F2`, border `#E4E6EA`, divider `#E8E9ED`.
- 05: green `#019A5F`, discovery `#F3F9F7`, neutral `#EBEFF2`.
- 06: green `#018F5E`, success `#DFF9F0`, success icon `#01B776`, border `#E7ECF0`.
- 07: green `#018F5B`, selected `#DAF4E9`, border `#E6EAED`.
- 08: green `#01A064`, selected `#F0FCF6`, neutral `#EBEEF1`.
- 09: green `#00A56A`, danger `#FC4548`, page `#F8F9F8`, border `#E7ECF0`.

Cards use measured 8–11 dp radii and quiet 1 dp borders. Selected/danger outlines use 2 dp where visible.
Modal radii are 11–16 dp. Shadows are restrained (`~4 dp / 12 dp / 8%` cards and
`~18 dp / 48 dp / 24%` modals); selection is expressed by border/fill, not glow.

Android system sans-serif is mandatory. Approximate D2 heading styles are 30sp/38 for 02 and 08,
26sp/34 for 03, 24sp/32 for 04/05/09, 20sp/28 for 06, and 22sp/30 for 07, all bold. Item titles are
18–22sp, body/buttons 16–18sp, metadata 14–16sp. Screenshot ink bounds, wrapping, and hierarchy—not
nominal `sp` alone—decide calibration.

## Required screen states

Every transport must expose additive, test, sync, physical status, execution result, and archive flows.
The composable state model must be able to render: empty, discovering/connecting, connected, syncing,
test executing, success, failure, uncertain/non-repeatable, offline, recovery/retry, and delete-confirm.
Archive language must never imply destruction of PrintJob or PrintAttempt history.

Production surfaces contain no diagnostic page or hidden diagnostic entry, log export, local service
switch, automatic-print switch, or menu/category routing. Failure text is merchant-facing and actionable;
debug payloads and raw logs stay out of the UI.

## Accessibility and localization

- Formal copy lives in Android resources for Chinese, Vietnamese, and English.
- Meaning is never color-only: every status has text and a semantic icon or label.
- Read-only values are exposed as text, not focusable switches.
- Controls have stable test tags and accessibility roles. Back and cancel obey system back navigation.
- D2 must preserve reference line counts. D10 and compact layouts may wrap to avoid clipping, but no
  translated label may be ellipsized into ambiguity.

## Pixel-diff acceptance

The comparison tool must produce a scaled reference, captured screenshot, absolute diff image, native
region MAE/RMSE, critical geometry deltas, and explicit masks. For 02 and 09, mask only the narrow live-Web
popup overlap `(D2 x201–227/y440–624)` and `(x196–220/y451–620)` respectively. For modal screens,
compare the modal interior as a hard region and report the shadow ring separately because its live Web
background varies. Time, merchant identity, table counts, and orders may be masked only outside native
surfaces.

No UI screen is complete until the D2 screenshot exists and the measured native-region result is reviewed
against this contract. Emulator screenshots are UI evidence only and never physical-printer evidence.
