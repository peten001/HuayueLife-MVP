import { Prisma } from '@prisma/client';
import { DEFAULT_CAPABILITIES } from './platform-dictionary-seed';
import {
  PlatformDictionariesService,
  RESERVED_PROMOTION_TAG_CODES,
} from './platform-dictionaries.service';

describe('PlatformDictionariesService read-only lists', () => {
  it('does not seed or update dictionaries during GET-backed reads', async () => {
    const prisma = {
      merchantBusinessType: {
        findMany: jest.fn(async () => []),
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
      promotionTag: {
        findMany: jest.fn(async () => []),
        createMany: jest.fn(),
      },
      capability: {
        findMany: jest.fn(async () => []),
        createMany: jest.fn(),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await Promise.all([
      service.listBusinessTypes(),
      service.listPromotionTags(),
      service.listCapabilities(),
    ]);

    expect(prisma.merchantBusinessType.createMany).not.toHaveBeenCalled();
    expect(prisma.merchantBusinessType.updateMany).not.toHaveBeenCalled();
    expect(prisma.promotionTag.createMany).not.toHaveBeenCalled();
    expect(prisma.capability.createMany).not.toHaveBeenCalled();
  });
});

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

describe('PlatformDictionariesService promotion tag lifecycle', () => {
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

  function createPrisma(createImpl?: (data: Record<string, unknown>) => unknown) {
    return {
      merchantBusinessType: {
        count: jest.fn(async () => 1),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      promotionTag: {
        count: jest.fn(async () => 1),
        create: jest.fn(async ({ data }) => createImpl?.(data) ?? tag({
          code: data.code,
          nameZh: data.nameZh,
          nameVi: data.nameVi ?? null,
          nameEn: data.nameEn ?? null,
          scope: data.scope,
          _count: undefined,
        })),
      },
      capability: { createMany: jest.fn(async () => ({ count: 0 })) },
    };
  }

  function deletePrisma(current: ReturnType<typeof tag>, removedCount: number) {
    const tx = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        delete: jest.fn(async () => current),
      },
      merchantPromotionTag: {
        deleteMany: jest.fn(async () => ({ count: removedCount })),
      },
    };
    return {
      tx,
      prisma: {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      },
    };
  }

  it.each([
    ['OPERATIONAL', 'OP_TEST'],
    ['CUISINE', 'CUISINE_HUNAN'],
    ['SCENE', 'SCENE_FAMILY'],
  ] as const)('creates a %s tag with its requested scope', async (scope, code) => {
    const prisma = createPrisma();
    const service = new PlatformDictionariesService(prisma as never);

    const result = await service.createPromotionTag({
      code,
      nameZh: `${scope} 标签`,
      scope,
    });

    expect(prisma.promotionTag.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code, scope }),
    });
    expect(result).toEqual(expect.objectContaining({ code, scope }));
  });

  it('returns an explicit conflict for a duplicate code', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    const prisma = createPrisma(() => { throw duplicate; });
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.createPromotionTag({
      code: 'CUISINE_HUNAN',
      nameZh: '湘菜',
      scope: 'CUISINE',
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PROMOTION_TAG_DUPLICATE' }),
    });
  });

  it('edits multilingual names without touching merchant relations', async () => {
    const current = tag({ _count: { merchants: 3 } });
    const updated = { ...current, nameZh: '湖南菜', nameVi: 'Ẩm thực Hồ Nam' };
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async () => updated),
      },
      merchantPromotionTag: { deleteMany: jest.fn() },
    };
    const service = new PlatformDictionariesService(prisma as never);

    const result = await service.updatePromotionTag(8n, {
      nameZh: '湖南菜',
      nameVi: 'Ẩm thực Hồ Nam',
      nameEn: 'Hunan cuisine',
    });

    expect(result).toEqual(expect.objectContaining({
      nameZh: '湖南菜',
      merchantReferenceCount: 3,
    }));
    expect(prisma.merchantPromotionTag.deleteMany).not.toHaveBeenCalled();
  });

  it('protects code and scope for every existing tag', async () => {
    const current = tag();
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.updatePromotionTag(8n, { code: 'CUISINE_NEW' }))
      .rejects.toThrow('标签编码创建后不可修改');
    await expect(service.updatePromotionTag(8n, { scope: 'SCENE' }))
      .rejects.toThrow('标签用途创建后不可修改');
    expect(prisma.promotionTag.update).not.toHaveBeenCalled();
  });

  it('allows only multilingual name edits on reserved tags', async () => {
    const current = tag({ code: 'HOT_FOOD', scope: 'OPERATIONAL', _count: { merchants: 2 } });
    const updated = { ...current, nameZh: '热门美食' };
    const prisma = {
      promotionTag: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async () => updated),
      },
    };
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.updatePromotionTag(8n, { nameZh: '热门美食' }))
      .resolves.toEqual(expect.objectContaining({ nameZh: '热门美食', reserved: true }));
    await expect(service.updatePromotionTag(8n, { enabled: false }))
      .rejects.toThrow('系统保留标签仅允许编辑多语言名称');
  });

  it('rejects referenced deletion without confirmation and reports the real count', async () => {
    const { prisma, tx } = deletePrisma(tag({ _count: { merchants: 3 } }), 3);
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.deletePromotionTag(8n)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAG_IN_USE', referenceCount: 3 }),
    });
    expect(tx.merchantPromotionTag.deleteMany).not.toHaveBeenCalled();
    expect(tx.promotionTag.delete).not.toHaveBeenCalled();
  });

  it('atomically unlinks every merchant before deleting a confirmed referenced tag', async () => {
    const { prisma, tx } = deletePrisma(tag({ _count: { merchants: 3 } }), 3);
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.deletePromotionTag(8n, true)).resolves.toEqual(expect.objectContaining({
      id: '8',
      deleted: true,
      merchantReferenceCount: 0,
      affectedMerchantCount: 3,
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.merchantPromotionTag.deleteMany).toHaveBeenCalledWith({
      where: { promotionTagId: 8n },
    });
    expect(tx.promotionTag.delete).toHaveBeenCalledWith({ where: { id: 8n } });
    expect(tx.merchantPromotionTag.deleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.promotionTag.delete.mock.invocationCallOrder[0]);
  });

  it('deletes an unreferenced tag in the same transaction with zero affected merchants', async () => {
    const { prisma, tx } = deletePrisma(tag(), 0);
    const service = new PlatformDictionariesService(prisma as never);

    await expect(service.deletePromotionTag(8n)).resolves.toEqual(expect.objectContaining({
      deleted: true,
      affectedMerchantCount: 0,
    }));
    expect(tx.merchantPromotionTag.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.promotionTag.delete).toHaveBeenCalledTimes(1);
  });

  it('hard-rejects deletion for every reserved homepage and discovery tag', async () => {
    expect([...RESERVED_PROMOTION_TAG_CODES]).toEqual([
      'HOT_FOOD',
      'FEATURED',
      'NEW_STORE',
      'POPULAR_NEARBY',
      'EDITOR_PICK',
    ]);
    for (const code of RESERVED_PROMOTION_TAG_CODES) {
      const { prisma, tx } = deletePrisma(tag({ code, scope: 'OPERATIONAL' }), 0);
      const service = new PlatformDictionariesService(prisma as never);
      await expect(service.deletePromotionTag(8n, true))
        .rejects.toThrow('系统保留标签不可删除');
      expect(tx.promotionTag.delete).not.toHaveBeenCalled();
    }
  });
});
