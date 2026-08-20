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

function promotionTag(
  id: bigint,
  code: string,
  scope: 'OPERATIONAL' | 'CUISINE' | 'SCENE',
  sortOrder: number,
) {
  return {
    promotionTag: {
      id,
      code,
      scope,
      sortOrder,
      nameZh: code,
      nameVi: `${code}-vi`,
      nameEn: `${code}-en`,
      iconText: null,
      color: null,
    },
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
  it('keeps operational tags visible while adding only sorted cuisine and scene tags to detail responses', () => {
    const tags = [
      promotionTag(1n, 'HOT_FOOD', 'OPERATIONAL', 0),
      promotionTag(2n, 'SCENE_FAMILY', 'SCENE', 20),
      promotionTag(3n, 'CUISINE_HUNAN', 'CUISINE', 10),
      promotionTag(4n, 'CUISINE_SICHUAN', 'CUISINE', 20),
      promotionTag(5n, 'CUISINE_CANTON', 'CUISINE', 30),
      promotionTag(6n, 'SCENE_GATHERING', 'SCENE', 10),
      promotionTag(7n, 'SCENE_DATE', 'SCENE', 30),
      promotionTag(8n, 'CUISINE_VIETNAMESE', 'CUISINE', 40),
      promotionTag(9n, 'CUISINE_THAI', 'CUISINE', 50),
      promotionTag(10n, 'SCENE_BUSINESS', 'SCENE', 40),
      promotionTag(11n, 'SCENE_LATE_NIGHT', 'SCENE', 50),
    ];
    const result = (service(true) as any).serializeMerchant(
      merchant({ promotionTags: tags }),
      [],
      null,
      [],
      [],
      true,
    );

    expect(result.promotionTags.map((item: any) => item.code)).toEqual(['HOT_FOOD']);
    expect(result.promotionTags.every((item: any) => item.scope === 'OPERATIONAL')).toBe(true);
    expect(result.detailDisplayTags.map((item: any) => item.code)).toEqual([
      'CUISINE_HUNAN',
      'CUISINE_SICHUAN',
      'CUISINE_CANTON',
      'CUISINE_VIETNAMESE',
      'SCENE_GATHERING',
      'SCENE_FAMILY',
      'SCENE_DATE',
      'SCENE_BUSINESS',
    ]);
    expect(result.detailDisplayTags.map((item: any) => item.code)).not.toEqual(expect.arrayContaining([
      'CUISINE_THAI',
      'SCENE_LATE_NIGHT',
    ]));
    expect(result.detailDisplayTags).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HOT_FOOD' }),
    ]));
  });

  it('keeps nearby serialization free of the detail-only tag field and consumer tag leakage', () => {
    const result = (service(true) as any).serializeMerchant(
      merchant({
        promotionTags: [
          promotionTag(1n, 'HOT_FOOD', 'OPERATIONAL', 0),
          promotionTag(3n, 'CUISINE_HUNAN', 'CUISINE', 10),
        ],
      }),
      [],
      null,
    );

    expect(result).not.toHaveProperty('detailDisplayTags');
    expect(result.promotionTags.map((item: any) => item.code)).toEqual(['HOT_FOOD']);
  });

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
