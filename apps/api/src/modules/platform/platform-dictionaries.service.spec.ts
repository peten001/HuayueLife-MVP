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

  const now = new Date('2026-08-14T00:00:00.000Z');
  const tag = (overrides: Record<string, unknown> = {}) => ({
    id: 8n,
    code: 'CUISINE_HUNAN',
    nameZh: '湘菜',
    nameVi: 'Món Hồ Nam',
    nameEn: 'Hunan cuisine',
    iconUrl: null,
    iconText: null,
    color: null,
    description: null,
    scope: 'CUISINE',
    sortOrder: 0,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    _count: { merchants: 0 },
    ...overrides,
  });

  it('protects reserved operational tags from code, scope, status and delete changes', async () => {
    const current = tag({ code: 'HOT_FOOD', scope: 'OPERATIONAL' });
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.updatePromotionTag(8n, { code: 'HOT_FOOD_NEW' }))
      .rejects.toThrow('系统保留标签编码不可修改');
    await expect(service.updatePromotionTag(8n, { scope: 'CUISINE' }))
      .rejects.toThrow('系统保留标签用途不可修改');
    await expect(service.updatePromotionTag(8n, { enabled: false }))
      .rejects.toThrow('系统保留标签不可停用');
    await expect(service.deletePromotionTag(8n))
      .rejects.toThrow('系统保留标签不可删除');
    expect(prisma.promotionTag.update).not.toHaveBeenCalled();
    expect(prisma.promotionTag.delete).not.toHaveBeenCalled();
  });

  it('protects referenced tag scope and deletion while allowing non-scope edits', async () => {
    const current = tag({ _count: { merchants: 3 } });
    const updated = { ...current, nameZh: '湖南菜' };
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async () => updated),
        delete: jest.fn(),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.updatePromotionTag(8n, { scope: 'SCENE' }))
      .rejects.toThrow('该标签已被商家使用，不能修改用途');
    await expect(service.deletePromotionTag(8n))
      .rejects.toThrow('该标签正在被 3 个商家使用');
    const result = await service.updatePromotionTag(8n, { nameZh: '湖南菜' });
    expect(result).toEqual(expect.objectContaining({
      nameZh: '湖南菜',
      merchantReferenceCount: 3,
      reserved: false,
    }));
    expect(prisma.promotionTag.delete).not.toHaveBeenCalled();
  });

  it('physically deletes an unreferenced non-reserved tag', async () => {
    const current = tag();
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        delete: jest.fn(async () => current),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.deletePromotionTag(8n)).resolves.toEqual(expect.objectContaining({
      id: '8',
      deleted: true,
      merchantReferenceCount: 0,
    }));
    expect(prisma.promotionTag.delete).toHaveBeenCalledWith({ where: { id: 8n } });
  });
});
