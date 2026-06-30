import type { MerchantProfile } from '@/types/api';

type CapabilitySource =
  | MerchantProfile
  | {
      merchantMode?: string;
      reportFeatureEnabled?: boolean;
      dineInEnabled?: boolean;
      pickupEnabled?: boolean;
      deliveryEnabled?: boolean;
      capabilities?: Array<{
        code: string;
        isEnabled: boolean;
      }>;
    }
  | null
  | undefined;

export function hasMerchantCapability(
  source: CapabilitySource,
  code: string,
) {
  const capabilities = source?.capabilities ?? [];
  if (capabilities.length) {
    return capabilities.some((item) => item.code === code && item.isEnabled);
  }
  return fallbackCapability(source, code);
}

export function canAccessMerchantFeature(
  source: CapabilitySource,
  feature: MerchantFeature,
) {
  if (feature === 'profile') return true;
  if (feature === 'orders') {
    return (
      hasMerchantCapability(source, 'onlineOrderEnabled') ||
      hasMerchantCapability(source, 'pickupEnabled') ||
      hasMerchantCapability(source, 'deliveryEnabled') ||
      hasMerchantCapability(source, 'qrOrderEnabled')
    );
  }
  if (feature === 'products') {
    return hasMerchantCapability(source, 'productDisplayEnabled');
  }
  if (feature === 'tables') {
    return hasMerchantCapability(source, 'tableManagementEnabled');
  }
  if (feature === 'printers') {
    return hasMerchantCapability(source, 'printerEnabled');
  }
  if (feature === 'reports') {
    return (
      hasMerchantCapability(source, 'zaloReportEnabled') ||
      Boolean(source?.reportFeatureEnabled)
    );
  }
  if (feature === 'chat') {
    return hasMerchantCapability(source, 'chatEnabled');
  }
  if (feature === 'voice') {
    return hasMerchantCapability(source, 'voiceNotifyEnabled');
  }
  return false;
}

export type MerchantFeature =
  | 'profile'
  | 'orders'
  | 'products'
  | 'tables'
  | 'printers'
  | 'reports'
  | 'chat'
  | 'voice';

function fallbackCapability(source: CapabilitySource, code: string) {
  if (!source || !('dineInEnabled' in source)) return false;
  const dineInEnabled = Boolean(source.dineInEnabled);
  const pickupEnabled = Boolean(source.pickupEnabled);
  const deliveryEnabled = Boolean(source.deliveryEnabled);
  const hasOrder = dineInEnabled || pickupEnabled || deliveryEnabled;
  const fallback: Record<string, boolean> = {
    phoneEnabled: true,
    navigationEnabled: true,
    imageGalleryEnabled: true,
    productDisplayEnabled: hasOrder,
    onlineOrderEnabled: pickupEnabled || deliveryEnabled,
    pickupEnabled,
    deliveryEnabled,
    qrOrderEnabled: dineInEnabled,
    tableManagementEnabled: dineInEnabled,
    printerEnabled: hasOrder,
    zaloReportEnabled: Boolean(source.reportFeatureEnabled),
    chatEnabled: hasOrder,
    voiceNotifyEnabled: hasOrder,
  };
  return Boolean(fallback[code]);
}
