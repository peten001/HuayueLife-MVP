import { PublicMerchantsService } from './public-merchants.service';

const FACILITY_CODES = [
  'chineseServiceEnabled',
  'privateRoomEnabled',
  'airConditioningEnabled',
  'freeWifiEnabled',
] as const;

function capability(code: string, isEnabled: boolean) {
  return {
    isEnabled,
    capability: {
      id: BigInt(code.length),
      code,
      nameZh: code,
      nameVi: null,
      nameEn: null,
    },
  };
}

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    nameZh: '验收商家',
    nameVi: null,
    nameEn: null,
    merchantMode: 'DISPLAY',
    claimStatus: 'UNCLAIMED',
    status: 'ACTIVE',
    isVisibleOnClient: true,
    logoUrl: null,
    coverUrl: null,
    addressDetail: '本地地址',
    addressZh: '本地地址',
    addressVi: null,
    addressEn: null,
    openingHoursText: null,
    descriptionZh: null,
    descriptionVi: null,
    descriptionEn: null,
    city: '本地',
    latitude: 0,
    longitude: 0,
    deliveryRadiusKm: 0,
    minimumDeliveryAmountVnd: 0n,
    deliveryFeeVnd: 0n,
    businessHours: {},
    homepageCategoryKeys: null,
    manualPopular: false,
    isNew: false,
    dineInEnabled: false,
    pickupEnabled: true,
    deliveryEnabled: true,
    businessType: null,
    promotionTags: [],
    images: [],
    signatureDishes: [],
    capabilities: [
      ...FACILITY_CODES.map((code) => capability(code, code !== 'airConditioningEnabled')),
      capability('pickupEnabled', true),
      capability('deliveryEnabled', true),
      capability('qrOrderEnabled', true),
    ],
    ...overrides,
  };
}

function service(platformOrderingEnabled: boolean) {
  return new PublicMerchantsService(
    {} as never,
    {
      resolveCapabilitiesFromMerchant: jest.fn((item) => ({
        pickupEnabled: Boolean(item.capabilities.find((entry: any) => entry.capability.code === 'pickupEnabled')?.isEnabled),
        deliveryEnabled: Boolean(item.capabilities.find((entry: any) => entry.capability.code === 'deliveryEnabled')?.isEnabled),
      })),
      resolveCapabilityFlag: jest.fn((item, code) =>
        Boolean(item.capabilities.find((entry: any) => entry.capability.code === code)?.isEnabled)),
    } as never,
    { isPlatformOrderingEnabled: jest.fn(() => platformOrderingEnabled) } as never,
  );
}

describe('PublicMerchantsService effective detail capabilities', () => {
  it('keeps display facilities effective but blocks raw pickup and delivery for DISPLAY merchants', () => {
    const result = (service(true) as any).serializeMerchant(merchant(), [], null);
    const values = new Map(result.capabilities.map((item: any) => [item.code, item.isEnabled]));

    expect(result.pickupEnabled).toBe(false);
    expect(result.deliveryEnabled).toBe(false);
    expect(result.supportedOrderTypes).toEqual([]);
    expect(values.get('pickupEnabled')).toBe(false);
    expect(values.get('deliveryEnabled')).toBe(false);
    expect(values.get('chineseServiceEnabled')).toBe(true);
    expect(values.get('privateRoomEnabled')).toBe(true);
    expect(values.get('airConditioningEnabled')).toBe(false);
    expect(values.get('freeWifiEnabled')).toBe(true);
  });

  it('exposes pickup and delivery only for MANAGED + CLAIMED merchants while the global gate is on', () => {
    const result = (service(true) as any).serializeMerchant(merchant({
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    }), [], null);

    expect(result.pickupEnabled).toBe(true);
    expect(result.deliveryEnabled).toBe(true);
    expect(result.qrOrderEnabled).toBe(true);
    expect(result.supportedOrderTypes).toEqual(['PICKUP', 'DELIVERY']);
  });

  it('keeps an individually disabled claimed ordering capability hidden while the global gate is on', () => {
    const claimed = merchant({
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    });
    const pickup = claimed.capabilities.find((item) => item.capability.code === 'pickupEnabled');
    if (pickup) pickup.isEnabled = false;

    const result = (service(true) as any).serializeMerchant(claimed, [], null);
    expect(result.pickupEnabled).toBe(false);
    expect(result.deliveryEnabled).toBe(true);
    expect(result.supportedOrderTypes).toEqual(['DELIVERY']);
  });

  it('hides ordering and QR capabilities when the global gate is off without hiding facilities', () => {
    const result = (service(false) as any).serializeMerchant(merchant({
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    }), [], null);
    const values = new Map(result.capabilities.map((item: any) => [item.code, item.isEnabled]));

    expect(result.pickupEnabled).toBe(false);
    expect(result.deliveryEnabled).toBe(false);
    expect(result.qrOrderEnabled).toBe(false);
    expect(result.supportedOrderTypes).toEqual([]);
    expect(values.get('qrOrderEnabled')).toBe(false);
    expect(values.get('chineseServiceEnabled')).toBe(true);
    expect(values.get('freeWifiEnabled')).toBe(true);
  });
});
