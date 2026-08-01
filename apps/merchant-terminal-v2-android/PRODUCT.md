# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

YunQiao Life restaurant merchants and staff operating a dedicated Android POS terminal. They stay in the existing full-screen Web Cashier and enter the native printer workflow from the lower-left account menu when they need to add, inspect, test, synchronize, or remove a local receipt printer.

## Product Purpose

Merchant Terminal V2 keeps the current Web Cashier intact while adding a reliable, merchant-facing Android surface and execution service for USB, LAN, and Classic Bluetooth ESC/POS printers. Success means all three transports share the same binding, physical-status, PrintJob, Attempt, archive, and no-duplicate-print guarantees, with a signed APK ready for user UI review and ADB field validation.

## Positioning

The terminal joins the merchant's existing authenticated cashier session to a terminal-scoped local printer identity and a fail-closed server job lease. A local write whose outcome is uncertain is recorded as `UNCERTAIN` and is never silently printed again.

## Operating Context

- Existing Web Cashier remains the full-screen daily workspace and retains its current layout and session behavior.
- Native printer/device pages overlay that WebView and close back to the same live WebView instance.
- Primary review target is SUNMI D2 at 1366x768 landscape; D10 Pro uses the same hierarchy at 1280x800; compact P10 uses a single-column native layout.
- Formal user copy is provided in Chinese, Vietnamese, and English.
- USB, LAN, and Classic Bluetooth hardware behavior remains subject to ADB-assisted field validation on real merchant devices and real printers.

## Capabilities and Constraints

- Add, local-test, synchronize, report status, execute jobs, and archive/delete USB, LAN, and Classic Bluetooth printers.
- Use V2-only incremental API routes and Terminal Bearer credentials without changing RC5/RC7 endpoint behavior.
- Keep printer business enablement and automatic-print rules read-only in Android; those settings remain in Merchant Admin.
- Preserve immutable job/attempt history and block duplicate output through content hashes, leases, and a local execution ledger.
- Do not include diagnostic pages or hidden diagnostic entry points, log export, a local-service switch, an automatic-print switch, or menu-category printer routing in the release APK.
- Do not replace or redraw the cashier background, tables, orders, sidebar, or top bar in Android.

## Brand Commitments

The product name is YunQiao Merchant Terminal V2. The individual PNG files in `YUNQIAO_MERCHANT_TERMINAL_V2_FULL_EXECUTION_PACKAGE/UI_REFERENCE` are the sole visual authority for native printer surfaces. Taste and Impeccable may extract and audit that authority, but may not redesign it.

## Evidence on Hand

- Locked V2 execution instruction and API contract package with verified SHA-256 manifests.
- Individual reference PNGs `00` through `09`; `10_CONTACT_SHEET.png` is navigation only.
- Existing production Web Cashier implementation and current stable Merchant Terminal WebView/session and RC5 USB receipt behavior on `origin/main` baseline `d6a6a1edd94507ec506271e8cac88c954d0f354d`.
- No real-device USB, LAN, Bluetooth, visible-paper, reboot, or field-routing evidence is created by emulator and fake-transport tests; future work must not fabricate it.

## Product Principles

- Preserve the cashier; add only the native printer surface.
- Treat every transport as a first-class route under one binding and job model.
- Fail closed when identity, readiness, lease, payload, or print outcome is uncertain.
- Keep field evidence distinct from local automation and emulator evidence.
- Match the locked reference before declaring UI completion.

## Accessibility & Inclusion

All formal user-facing copy must remain legible and untruncated in Chinese, Vietnamese, and English across D2, D10 Pro, and compact P10 layouts. Controls must remain usable with Android touch and system back navigation.
