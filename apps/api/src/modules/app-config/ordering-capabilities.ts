export const ORDERING_CAPABILITY_CODES = new Set([
  'onlineOrderEnabled',
  'pickupEnabled',
  'deliveryEnabled',
  'dineInEnabled',
  'qrOrderEnabled',
  'tableManagementEnabled',
  'printerEnabled',
  'voiceNotifyEnabled',
  'voiceBroadcastEnabled',
  'chatEnabled',
  'orderChatEnabled',
  'zaloReportEnabled',
]);

export function isOrderingCapabilityCode(code: string) {
  return ORDERING_CAPABILITY_CODES.has(code);
}
