// Single source of truth for the merchant-terminal download page.
// Keep APK metadata out of printing-center components.
export const androidTerminalRelease = {
  appName: 'YunQiao Terminal USB Print Test',
  versionName: '1.0.0-print-usb-write-test2',
  releaseType: 'TEST',
  packageName: 'com.yunqiao.life.merchantterminal.printclosuretest1',
  fileName: 'yunqiao-merchant-terminal-v1.0.0-print-usb-write-test2.apk',
  fileSizeBytes: 2_551_629,
  sha256: '5e24e337334f847e0429df5bb3d9d8fdddc0b36b849dfdb48e2a84c7a1e8d65d',
  updatedAt: '2026-07-25 19:51 (GMT+7)',
  downloadUrl: '/downloads/apk/yunqiao-merchant-terminal-v1.0.0-print-usb-write-test2.apk',
} as const;

export function formatAndroidTerminalFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB / ${new Intl.NumberFormat('en-US').format(bytes)} bytes`;
}
