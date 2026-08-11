import { PublicMerchantsService } from './public-merchants.service';

function publicMerchant(signatureDishes: any[], overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function service(categoryFindFirst = jest.fn()) {
  return new PublicMerchantsService(
    { category: { findFirst: categoryFindFirst } } as never,
    {
      resolveCapabilitiesFromMerchant: jest.fn(() => ({ pickupEnabled: false, deliveryEnabled: false })),
      resolveCapabilityFlag: jest.fn(() => false),
    } as never,
    { isPlatformOrderingEnabled: jest.fn(() => false) } as never,
  );
}

describe('PublicMerchantsService signature dishes', () => {
  it('keeps DISPLAY / UNCLAIMED merchant signature dishes on the independent content source', async () => {
    const findFirst = jest.fn();
    const subject = service(findFirst);
    const visible = {
      id: 9n,
      nameZh: '平台独立招牌菜',
      nameVi: 'Mon dac biet',
      nameEn: 'Signature Dish',
      imageUrl: '/uploads/merchants/signature.png',
      sortOrder: 2,
    };
    const merchant = publicMerchant([visible]);

    await expect((subject as any).resolveSignatureDishes(merchant)).resolves.toEqual([visible]);
    expect(findFirst).not.toHaveBeenCalled();
    expect((subject as any).serializeMerchant(merchant, [], null).signatureDishes).toEqual([
      {
        id: '9',
        nameZh: '平台独立招牌菜',
        nameVi: 'Mon dac biet',
        nameEn: 'Signature Dish',
        imageUrl: '/uploads/merchants/signature.png',
        sortOrder: 2,
      },
    ]);
  });

  it('uses only public products in the active signature category for MANAGED / CLAIMED merchants', async () => {
    const findFirst = jest.fn(async () => ({
      products: [
        {
          id: 12n,
          nameZh: '真实菜单菜品',
          nameVi: 'Món thực đơn',
          nameEn: 'Menu dish',
          imageUrl: null,
          sortOrder: 3,
        },
      ],
    }));
    const subject = service(findFirst);
    const merchant = publicMerchant([
      {
        id: 99n,
        nameZh: '历史平台招牌菜',
        nameVi: null,
        nameEn: null,
        imageUrl: '/legacy.png',
        sortOrder: 0,
      },
    ], {
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    });

    const signatureDishes = await (subject as any).resolveSignatureDishes(merchant);

    expect(signatureDishes).toEqual([
      {
        id: 12n,
        nameZh: '真实菜单菜品',
        nameVi: 'Món thực đơn',
        nameEn: 'Menu dish',
        imageUrl: '',
        sortOrder: 3,
      },
    ]);
    expect((subject as any).serializeMerchant(merchant, [], null, [], signatureDishes).signatureDishes)
      .toEqual([
        {
          id: '12',
          nameZh: '真实菜单菜品',
          nameVi: 'Món thực đơn',
          nameEn: 'Menu dish',
          imageUrl: '',
          sortOrder: 3,
        },
      ]);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        merchantId: 1n,
        isSignature: true,
        isActive: true,
      },
      select: {
        products: {
          where: {
            productType: 'FOOD',
            status: { in: ['ON_SALE', 'SOLD_OUT'] },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 15,
          select: {
            id: true,
            nameZh: true,
            nameVi: true,
            nameEn: true,
            imageUrl: true,
            sortOrder: true,
          },
        },
      },
    });
  });

  it('returns an empty claimed signature-dish view model when the signature category has no public products', async () => {
    const subject = service(jest.fn(async () => ({ products: [] })));
    const merchant = publicMerchant([], {
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    });

    await expect((subject as any).resolveSignatureDishes(merchant)).resolves.toEqual([]);
  });
});
