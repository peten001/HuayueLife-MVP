# V2 D2 pixel-diff report

Status: **NOT EXECUTED BY USER REQUIREMENT**. The user explicitly requested no
Android emulator, installation, automated interaction, screenshot capture, or
pixel-diff generation in this round. This file records that boundary rather than
substituting a visual claim for missing device evidence.

## Capture identity

- APK/build revision: `2.0.0-rc1` / versionCode `40`
- Emulator AVD and image: **NOT EXECUTED** (user requested emulator skip)
- Resolution/density/orientation: **NOT EXECUTED**
- Locale: **NOT EXECUTED**
- Animation scales and font scale: **NOT EXECUTED**
- Capture timestamp: pending

## Results

| Screen | Screenshot | Native crop/mask | MAE | RMSE | Max critical geometry delta | Decision |
|---|---|---|---:|---:|---:|---|
| 02 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 03 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 04 | not captured | source geometry reviewed; Bluetooth extension recorded | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 05 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 06 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 07 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 08 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |
| 09 | not captured | source geometry reviewed | n/a | n/a | n/a | SOURCE REVIEW PASS; USER UI REVIEW PENDING |

## Required artifacts per row

No capture, resized reference, crop, heat map, MAE/RMSE, or edge measurement was
generated in this round. The source implementation was reviewed against the
individual PNG references; typography, wrapping, icons, shadow intent, and the
required Bluetooth extension are documented in `V2_UI_DESIGN_SPEC.md`. Final
visual and physical behavior remain with the user's manual validation.

Screen 04 cannot be declared a literal zero diff because the source omits mandatory Classic Bluetooth.
The report must compare the unchanged card grammar and annotate the extension rather than hiding it with a
mask. No native mismatch may be masked. A passing screenshot remains emulator UI evidence only.
