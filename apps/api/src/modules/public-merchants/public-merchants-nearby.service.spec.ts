import 'reflect-metadata';
import { PromotionTagScope } from '@prisma/client';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';
import { PublicMerchantsService } from './public-merchants.service';

const OPEN_ALL_DAY = {
  monday: ['00:00-23:59'],
  tuesday: ['00:00-23:59'],
  wednesday: ['00:00-23:59'],
  thursday: ['00:00-23:59'],
  friday: ['00:00-23:59'],
  saturday: ['00:00-23:59'],
  sunday: ['00:00-23:59'],
};

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

function promotionTag(code: string) {
  return {
    promotionTag: {
      id: BigInt(code.length),
      code,
      nameZh: code,
      nameVi: null,
      nameEn: null,
      iconText: null,
      color: null,
      scope: PromotionTagScope.OPERATIONAL,
      sortOrder: 0,
    },
  };
}

function merchant(
  id: number,
  overrides: Record<string, unknown> = {},
): any {
  return {
    id: BigInt(id),
    nameZh: `测试商家${String(id).padStart(2, '0')}`,
    nameVi: null,
    nameEn: null,
    merchantMode: 'MANAGED',
    claimStatus: 'CLAIMED',
    status: 'ACTIVE',
    isVisibleOnClient: true,
    logoUrl: null,
    coverUrl: null,
    addressDetail: `北江测试地址${id}`,
    addressZh: null,
    addressVi: null,
    addressEn: null,
    openingHoursText: null,
    descriptionZh: null,
    descriptionVi: null,
    descriptionEn: null,
    province: '北江',
    city: '北江',
    latitude: 21,
    longitude: 106,
    deliveryRadiusKm: 10,
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
    images: [],
    categories: [],
    capabilities: [
      capability('pickupEnabled', false),
      capability('deliveryEnabled', false),
      capability('qrOrderEnabled', false),
    ],
    ...overrides,
  };
}

function nearbyQuery(overrides: Record<string, unknown>) {
  return Object.assign(new NearbyMerchantsQueryDto(), overrides);
}

function createService(rows: any[], platformOrderingEnabled = true) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const service = new PublicMerchantsService(
    { merchant: { findMany } } as never,
    {
      resolveCapabilitiesFromMerchant: jest.fn((item) => ({
        pickupEnabled: Boolean(item.capabilities.find(
          (entry: ReturnType<typeof capability>) => entry.capability.code === 'pickupEnabled',
        )?.isEnabled),
        deliveryEnabled: Boolean(item.capabilities.find(
          (entry: ReturnType<typeof capability>) => entry.capability.code === 'deliveryEnabled',
        )?.isEnabled),
      })),
      resolveCapabilityFlag: jest.fn((item, code) => Boolean(item.capabilities.find(
        (entry: ReturnType<typeof capability>) => entry.capability.code === code,
      )?.isEnabled)),
    } as never,
    { isPlatformOrderingEnabled: jest.fn(() => platformOrderingEnabled) } as never,
  );
  return { service, findMany };
}

describe('PublicMerchantsService homepage query, ordering and pagination', () => {
  it('filters the complete regional set by homepage category before pagination', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => merchant(index + 1));
    rows[20].homepageCategoryKeys = JSON.stringify(['coffee_milk_tea']);
    const { service } = createService(rows);

    const result = await service.nearby(nearbyQuery({
      province: '北江',
      page: 1,
      homepageCategoryKey: 'coffee_milk_tea',
    }));

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual([21n]);

    const empty = await service.nearby(nearbyQuery({
      province: '北江',
      page: 1,
      homepageCategoryKey: 'fresh_fruit',
    }));
    expect(empty).toMatchObject({ items: [], total: 0, page: 1 });
  });

  it('keeps HOT_FOOD and manualPopular in the popular category compatibility layer only', async () => {
    const rows = [
      merchant(1, { promotionTags: [promotionTag('HOT_FOOD')] }),
      merchant(2, { manualPopular: true }),
      merchant(3, { homepageCategoryKeys: JSON.stringify(['popular_food']) }),
      merchant(4),
    ];
    const { service } = createService(rows);

    const result = await service.nearby(nearbyQuery({
      province: '北江',
      page: 1,
      homepageCategoryKey: 'popular_food',
    }));

    expect(result.items.map((item) => item.id)).toEqual([1n, 2n, 3n]);
    expect(result.total).toBe(3);
  });

  it('searches the complete regional set and reports a filtered total', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => merchant(index + 1));
    rows[20].nameZh = '农品香-湘菜馆';
    const { service } = createService(rows);

    const found = await service.nearby(nearbyQuery({ province: '北江', page: 1, keyword: ' 农品香 ' }));
    expect(found.items.map((item) => item.id)).toEqual([21n]);
    expect(found.total).toBe(1);

    const empty = await service.nearby(nearbyQuery({ province: '北江', page: 1, keyword: '不存在的商家' }));
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
  });

  it('applies OPEN, PICKUP, DELIVERY and DINE_IN effective filters before pagination', async () => {
    const rows = [
      merchant(1, { businessHours: OPEN_ALL_DAY }),
      merchant(2, {
        capabilities: [
          capability('pickupEnabled', true),
          capability('deliveryEnabled', false),
          capability('qrOrderEnabled', false),
        ],
      }),
      merchant(3, {
        capabilities: [
          capability('pickupEnabled', false),
          capability('deliveryEnabled', true),
          capability('qrOrderEnabled', false),
        ],
      }),
      merchant(4, { dineInEnabled: true }),
      merchant(5, {
        merchantMode: 'DISPLAY',
        claimStatus: 'UNCLAIMED',
        capabilities: [
          capability('pickupEnabled', true),
          capability('deliveryEnabled', true),
          capability('qrOrderEnabled', true),
        ],
      }),
    ];
    const { service } = createService(rows);

    await expect(service.nearby(nearbyQuery({ province: '北江', page: 1, serviceFilter: ['OPEN'] })))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ id: 1n })] });
    await expect(service.nearby(nearbyQuery({ province: '北江', page: 1, serviceFilter: ['PICKUP'] })))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ id: 2n })] });
    await expect(service.nearby(nearbyQuery({ province: '北江', page: 1, serviceFilter: ['DELIVERY'] })))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ id: 3n })] });
    await expect(service.nearby(nearbyQuery({ province: '北江', page: 1, serviceFilter: ['DINE_IN'] })))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ id: 4n })] });

    const gateOff = createService(rows, false).service;
    await expect(gateOff.nearby(nearbyQuery({ province: '北江', page: 1, serviceFilter: ['PICKUP'] })))
      .resolves.toMatchObject({ total: 0, items: [] });
  });

  it('uses FEATURED as the only promotion priority and preserves the baseline comparator', async () => {
    const rows = [
      merchant(10, {
        nameZh: '同级普通商家',
        manualPopular: true,
        promotionTags: [promotionTag('HOT_FOOD')],
        latitude: 21,
        longitude: 106,
        businessHours: OPEN_ALL_DAY,
      }),
      merchant(5, {
        nameZh: '同级普通商家',
        latitude: 21,
        longitude: 106,
        businessHours: OPEN_ALL_DAY,
      }),
      merchant(30, {
        nameZh: '精选较远',
        promotionTags: [promotionTag('FEATURED'), promotionTag('HOT_FOOD')],
        latitude: 21.2,
        longitude: 106.2,
      }),
      merchant(20, {
        nameZh: '精选较近',
        promotionTags: [promotionTag('FEATURED')],
        latitude: 21.1,
        longitude: 106.1,
      }),
      merchant(4, {
        nameZh: '同名',
        latitude: 'invalid',
        longitude: 'invalid',
      }),
      merchant(2, {
        nameZh: '同名',
        latitude: 'invalid',
        longitude: 'invalid',
      }),
    ];
    const { service } = createService(rows);

    const result = await service.nearby(nearbyQuery({
      province: '北江',
      page: 1,
      lat: 21,
      lng: 106,
    }));

    expect(result.items.map((item) => item.id)).toEqual([20n, 30n, 5n, 10n, 2n, 4n]);
  });

  it('sorts the globally ranked set before slicing pages without duplicates', async () => {
    const rows = Array.from({ length: 22 }, (_, index) => merchant(index + 1));
    rows[21].promotionTags = [promotionTag('FEATURED')];
    const { service } = createService(rows);

    const pageOne = await service.nearby(nearbyQuery({ province: '北江', page: 1 }));
    const pageTwo = await service.nearby(nearbyQuery({ province: '北江', page: 2 }));
    const pageOneIds = pageOne.items.map((item) => item.id);
    const pageTwoIds = pageTwo.items.map((item) => item.id);

    expect(pageOneIds[0]).toBe(22n);
    expect(pageOneIds).toHaveLength(20);
    expect(pageTwoIds).toEqual([20n, 21n]);
    expect(new Set([...pageOneIds, ...pageTwoIds]).size).toBe(22);
    expect(pageOne.total).toBe(22);
    expect(pageTwo.total).toBe(22);
  });

  it('preserves legacy Prisma filters and propagates database failures', async () => {
    const { service, findMany } = createService([]);
    await service.nearby(nearbyQuery({
      province: '北江',
      page: 1,
      businessTypeId: '8',
      promotionTag: 'EDITOR_PICK',
    }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        businessTypeId: 8n,
        promotionTags: {
          some: { promotionTag: { code: 'EDITOR_PICK', enabled: true } },
        },
      }),
    }));

    findMany.mockRejectedValueOnce(new Error('database offline'));
    await expect(service.nearby(nearbyQuery({ province: '北江', page: 1 })))
      .rejects.toThrow('database offline');
  });
});
