import { DEFAULT_CAPABILITIES } from './platform-dictionary-seed';
import { PlatformDictionariesService } from './platform-dictionaries.service';

describe('PlatformDictionariesService capability provisioning', () => {
  it('repeat-safely provisions all fixed capability codes into initialized environments', async () => {
    const prisma = {
      merchantBusinessType: {
        count: jest.fn(async () => 1),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      promotionTag: { count: jest.fn(async () => 1) },
      capability: {
        createMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await service.ensureDefaults();
    await service.ensureDefaults();

    expect(prisma.capability.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.capability.createMany).toHaveBeenLastCalledWith({
      data: DEFAULT_CAPABILITIES,
      skipDuplicates: true,
    });
    expect(DEFAULT_CAPABILITIES).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'chineseServiceEnabled', nameZh: '中文服务' }),
      expect.objectContaining({ code: 'privateRoomEnabled', nameZh: '有包间' }),
      expect.objectContaining({ code: 'airConditioningEnabled', nameZh: '空调环境' }),
      expect.objectContaining({ code: 'freeWifiEnabled', nameZh: '免费 Wi-Fi' }),
    ]));
  });
});

describe('PlatformDictionariesService promotion tag scopes', () => {
  it('persists and returns the consumer-facing scope', async () => {
    const createdAt = new Date('2026-08-13T00:00:00.000Z');
    const prisma = {
      merchantBusinessType: {
        count: jest.fn(async () => 1),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      promotionTag: {
        count: jest.fn(async () => 1),
        create: jest.fn(async ({ data }) => ({
          id: 8n,
          code: data.code,
          nameZh: data.nameZh,
          nameVi: data.nameVi ?? null,
          nameEn: data.nameEn ?? null,
          iconUrl: null,
          iconText: null,
          color: null,
          description: null,
          scope: data.scope,
          sortOrder: data.sortOrder ?? 0,
          enabled: data.enabled ?? true,
          createdAt,
          updatedAt: createdAt,
        })),
      },
      capability: { createMany: jest.fn(async () => ({ count: 0 })) },
    };
    const service = new PlatformDictionariesService(prisma as never);

    const result = await service.createPromotionTag({
      code: 'CUISINE_HUNAN',
      nameZh: '湘菜',
      nameVi: 'Món Hồ Nam',
      nameEn: 'Hunan cuisine',
      scope: 'CUISINE',
    });

    expect(prisma.promotionTag.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'CUISINE' }),
    });
    expect(result).toEqual(expect.objectContaining({
      code: 'CUISINE_HUNAN',
      nameZh: '湘菜',
      scope: 'CUISINE',
    }));
  });
});
