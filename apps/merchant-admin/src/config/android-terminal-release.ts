// Single source of truth for the merchant-terminal download page.
// Keep APK metadata out of printing-center components.
export const androidTerminalRelease = {
  appName: 'YunQiao Merchant Terminal',
  versionName: '1.0.0-rc6',
  versionCode: 13,
  releaseType: 'OFFICIAL_OPTIONAL_UPGRADE',
  packageName: 'com.yunqiao.life.merchantterminal',
  fileName: 'YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk',
  fileSizeBytes: 2_051_509,
  sha256: '8970fb3ef649fe0795f6313febf10a2355cfa56807011f524c11bb2691c8cb26',
  updatedAt: '2026-07-28 20:25 (GMT+7)',
  downloadUrl: '/downloads/apk/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk',
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
