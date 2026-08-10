import { PublicMerchantsService } from './public-merchants.service';

function publicMerchant(signatureDishes: any[]) {
  return {
    id: 1n,
    nameZh: '展示商家',
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
    minimumDeliveryAmountVnd: 0,
    deliveryFeeVnd: 0,
    businessHours: {},
    homepageCategoryKeys: null,
    manualPopular: false,
    isNew: false,
    dineInEnabled: false,
    businessType: null,
    promotionTags: [],
    capabilities: [],
    images: [],
    signatureDishes,
  };
}

describe('PublicMerchantsService signature dishes', () => {
  it('serializes only the public signature dish fields and keeps historical merchants as []', () => {
    const service = new PublicMerchantsService(
      {} as never,
      {
        resolveCapabilitiesFromMerchant: jest.fn(() => ({ pickupEnabled: false, deliveryEnabled: false })),
        resolveCapabilityFlag: jest.fn(() => false),
      } as never,
      { isPlatformOrderingEnabled: jest.fn(() => false) } as never,
    );

    const visible = {
      id: 9n,
      nameZh: '招牌菜',
      nameVi: 'Mon dac biet',
      nameEn: 'Signature Dish',
      imageUrl: '/uploads/merchants/signature.png',
      sortOrder: 2,
    };
    const result = (service as any).serializeMerchant(publicMerchant([visible]), [], null);
    expect(result.signatureDishes).toEqual([
      {
        id: '9',
        nameZh: '招牌菜',
        nameVi: 'Mon dac biet',
        nameEn: 'Signature Dish',
        imageUrl: '/uploads/merchants/signature.png',
        sortOrder: 2,
      },
    ]);
    expect((service as any).serializeMerchant(publicMerchant([]), [], null).signatureDishes).toEqual([]);
  });

  it('queries public detail with an isVisible-only, stable signature dish ordering', async () => {
    const merchant = publicMerchant([]);
    const findFirst = jest.fn(async () => merchant);
    const findMany = jest.fn(async () => []);
    const service = new PublicMerchantsService(
      { merchant: { findFirst }, category: { findMany } } as never,
      {
        resolveCapabilitiesFromMerchant: jest.fn(() => ({ pickupEnabled: false, deliveryEnabled: false })),
        resolveCapabilityFlag: jest.fn(() => false),
      } as never,
      { isPlatformOrderingEnabled: jest.fn(() => false) } as never,
    );

    await service.detail(1n);
    const calls = (findFirst as jest.Mock).mock.calls as unknown[][];
    const query = calls[0]?.[0] as any;
    expect(query.include.signatureDishes).toEqual({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        nameZh: true,
        nameVi: true,
        nameEn: true,
        imageUrl: true,
        sortOrder: true,
      },
    });
  });
});
