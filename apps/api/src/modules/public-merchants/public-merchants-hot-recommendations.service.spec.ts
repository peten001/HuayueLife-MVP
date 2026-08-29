import { PublicMerchantsService } from './public-merchants.service';

function serviceWith(categories: any[], sales: any[]) {
  return new PublicMerchantsService(
    {
      category: { findMany: jest.fn(async () => categories) },
      orderItem: { groupBy: jest.fn(async () => sales) },
    } as never,
    {
      resolveCapabilitiesFromMerchant: jest.fn(() => ({ pickupEnabled: false, deliveryEnabled: false })),
      resolveCapabilityFlag: jest.fn(() => false),
    } as never,
    { isPlatformOrderingEnabled: jest.fn(() => false) } as never,
  );
}

function serializableMerchant() {
  return {
    id: 1n,
    nameZh: '热销验收商家',
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
    pickupEnabled: false,
    deliveryEnabled: false,
    businessType: null,
    promotionTags: [],
    capabilities: [],
    images: [],
    signatureDishes: [],
  };
}

describe('PublicMerchantsService hot recommendations', () => {
  it('uses completed PICKUP/DELIVERY/DINE_IN sales, excludes rice and drinks, and keeps a stable top eight', async () => {
    const products = Array.from({ length: 9 }, (_, index) => ({
      id: BigInt(index + 1),
      nameZh: `菜${index + 1}`,
      nameVi: null,
      nameEn: `Dish ${index + 1}`,
      imageUrl: `/dish-${index + 1}.jpg`,
      menuThumbnailUrl: `/thumb-${index + 1}.webp`,
      priceVnd: BigInt((index + 1) * 25_000),
      sortOrder: index,
      status: 'ON_SALE',
      productType: 'FOOD',
    }));
    const service = serviceWith(
      [
        { id: 1n, nameZh: '招牌菜', sortOrder: 0, products },
        { id: 2n, nameZh: '饮料', sortOrder: 1, products: [{ ...products[0], id: 99n }] },
      ],
      products.map((product, index) => ({ productId: product.id, _sum: { quantity: index === 8 ? 0 : 5 } })),
    );

    const result = await (service as any).hotRecommendations(1n);
    expect(result).toHaveLength(8);
    expect(result.map((item: any) => item.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'].map(BigInt));
    expect(result.map((item: any) => item.hotRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result[0].priceVnd).toBe(25_000n);
    expect(result[0].imageUrl).toBe('/dish-1.jpg');

    const groupBy = ((service as any).prisma.orderItem.groupBy as jest.Mock).mock.calls[0][0];
    expect(groupBy.where).toMatchObject({
      productId: { not: null },
      order: { merchantId: 1n, status: 'COMPLETED', orderType: { in: ['PICKUP', 'DELIVERY', 'DINE_IN'] } },
    });
  });

  it('serializes the current Product price as the additive public priceVnd field', () => {
    const service = serviceWith([], []);
    const result = (service as any).serializeMerchant(serializableMerchant(), [], null, [{
      id: 7n,
      nameZh: '真实价格菜品',
      nameVi: null,
      nameEn: 'Real Price Dish',
      imageUrl: '/dish-7.jpg',
      priceVnd: 135_000n,
      salesCount: 12,
      hotRank: 1,
    }]);

    expect(result.hotRecommendations).toEqual([expect.objectContaining({
      id: '7',
      priceVnd: '135000',
      salesCount: 12,
      hotRank: 1,
    })]);
  });
});
