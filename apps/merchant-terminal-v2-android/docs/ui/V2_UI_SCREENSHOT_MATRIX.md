# V2 screenshot matrix

This matrix records the user-requested validation boundary. The user explicitly
prohibited emulator startup, APK installation, automated clicks, screenshots, and
pixel diffs in this round. All device evidence is therefore marked **NOT
EXECUTED** and must be completed during user manual validation.

| Screen | D2 zh 1366×768 strict PNG + diff | D10 zh 1280×800 layout PNG | compact/P10 zh layout PNG |
|---|---|---|---|
| 02 overview | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 03 local service | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 04 connection type | NOT EXECUTED; Bluetooth is the documented content extension | NOT EXECUTED | NOT EXECUTED |
| 05 LAN discovery | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 06 LAN success | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 07 USB setup | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 08 Classic Bluetooth setup | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| 09 printer detail | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |

Localization evidence is deliberately smaller than the visual matrix:

- zh/en/vi resource key parity: automated by `docs/ui/verify_ui_locale_keys.sh`.
- Vietnamese and English long-copy captures: representative screens 02, 05, 08, and 09 on each target
  device; verify no clipping, ambiguous ellipsis, or action overlap.
- Empty, discovering/connecting, syncing, failure, uncertain, recovery, and delete-confirm behavior is
  covered by state/interaction tests rather than dozens of redundant reference-diff rows.

Required file naming:

`<device>-<locale>-<screen>-<buildRevision>.png`

No screenshot harness was executed or delivered in this round. The source
implementation has no release route, deep link, hidden tap, or exported component
for screenshot capture.
