type MerchantOrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';

export interface MerchantOrderingVisibilityInput {
  merchantMode?: string;
  claimStatus?: string;
  isOpen: boolean;
  platformOrderingEnabled: boolean;
  hasCapabilityRecords: boolean;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  dineInEnabled?: boolean;
  qrOrderEnabled?: boolean;
  enabledCapabilityCodes: ReadonlySet<string>;
  supportedOrderTypes: readonly MerchantOrderType[];
}

export interface MerchantOrderingVisibility {
  pickupFacilityVisible: boolean;
  deliveryFacilityVisible: boolean;
  qrFacilityVisible: boolean;
  pickupCtaVisible: boolean;
  deliveryCtaVisible: boolean;
}

export function resolveMerchantOrderingVisibility(
  input: MerchantOrderingVisibilityInput,
): MerchantOrderingVisibility {
  const isClaimedMerchant = input.merchantMode === 'MANAGED' && input.claimStatus === 'CLAIMED';
  const pickupSupported =
    isClaimedMerchant &&
    input.platformOrderingEnabled &&
    (input.hasCapabilityRecords
      ? (input.pickupEnabled ?? input.enabledCapabilityCodes.has('pickupEnabled'))
      : input.supportedOrderTypes.includes('PICKUP'));
  const deliverySupported =
    isClaimedMerchant &&
    input.platformOrderingEnabled &&
    (input.hasCapabilityRecords
      ? (input.deliveryEnabled ?? input.enabledCapabilityCodes.has('deliveryEnabled'))
      : input.supportedOrderTypes.includes('DELIVERY'));
  const qrSupported =
    isClaimedMerchant &&
    input.platformOrderingEnabled &&
    Boolean(input.dineInEnabled) &&
    (input.hasCapabilityRecords
      ? (input.qrOrderEnabled ?? input.enabledCapabilityCodes.has('qrOrderEnabled'))
      : input.supportedOrderTypes.includes('DINE_IN'));

  return {
    pickupFacilityVisible: pickupSupported,
    deliveryFacilityVisible: deliverySupported,
    qrFacilityVisible: qrSupported,
    pickupCtaVisible: pickupSupported && input.supportedOrderTypes.includes('PICKUP'),
    deliveryCtaVisible: deliverySupported && input.supportedOrderTypes.includes('DELIVERY'),
  };
}
