// Single source of truth for the merchant-terminal download page.
// Keep APK metadata out of printing-center components.
export const androidTerminalRelease = {
  appName: 'YunQiao Merchant Terminal',
  versionName: '2.0.0-rc11.5',
  versionCode: 60,
  releaseType: 'OFFICIAL_OPTIONAL_UPGRADE',
  packageName: 'com.yunqiao.life.merchantterminal',
  fileName: 'YunQiao-Merchant-Terminal-v2.0.0-rc11.5-signed.apk',
  fileSizeBytes: 2_216_758,
  sha256: 'f0b51ea37f3e773677b3b6197a83c068eba62bcec39c47d6313f9d4a02e948d6',
  updatedAt: '2026-08-07 08:49 (GMT+7)',
  downloadUrl: '/downloads/apk/YunQiao-Merchant-Terminal-v2.0.0-rc11.5-signed.apk',
  releaseNoteKeys: [
    'androidTerminalReleaseNoteBilingual',
    'androidTerminalReleaseNoteUsb',
    'androidTerminalReleaseNotePrintingCenter',
    'androidTerminalReleaseNoteRc5Supported',
    'androidTerminalReleaseNoteOptionalUpgrade',
  ],
  pendingAcceptanceKeys: [
    'androidTerminalPendingDeviceValidation',
    'androidTerminalPendingCloudDeviceValidation',
    'androidTerminalPendingLanCompatibility',
  ],
} as const;

export function formatAndroidTerminalFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB / ${new Intl.NumberFormat('en-US').format(bytes)} bytes`;
}
