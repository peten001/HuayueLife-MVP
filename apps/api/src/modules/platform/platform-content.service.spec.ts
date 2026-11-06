import { PlatformContentService } from "./platform-content.service";
function harness() {
  const original = {
    categories: [],
    topics: [],
    tags: [
      {
        id: "1",
        code: "FAMILY",
        nameZh: "家庭友好",
        nameVi: "Gia đình",
        scope: "SCENE",
        enabled: true,
        sortOrder: 0,
      },
    ],
    recommendations: [],
    version: 0,
    baseRevision: "REVISION",
  };
  const proofs = new Map<string, unknown>();
  const tx = {
    platformSetting: {
      findUnique: jest.fn(
        async ({ where }: { where: { key: string } }) =>
          proofs.get(where.key) || null,
      ),
      create: jest.fn(
        async ({ data }: { data: { key: string; value: unknown } }) => {
          proofs.set(data.key, { value: data.value });
          return data;
        },
      ),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    merchantBusinessType: { findMany: jest.fn().mockResolvedValue([]) },
    promotionTag: {
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    merchant: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    merchantReview: { groupBy: jest.fn().mockResolvedValue([]) },
    merchantPromotionTag: { upsert: jest.fn(), deleteMany: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn((run: Function) => run(tx)) };
  const service = new PlatformContentService(prisma as never);
  jest
    .spyOn(service as any, "current")
    .mockResolvedValue({ data: original, merchants: [] });
  const draft = JSON.parse(JSON.stringify(original));
  draft.tags[0].nameZh = "亲子友好";
  return { service, tx, prisma, draft, proofs };
}
describe("Platform content staging and publication", () => {
  it("includes merchants created after a saved draft while retaining existing draft choices", async () => {
    const h = harness();
    const old = {
      merchantId: "1",
      manualPopular: false,
      homepageCategoryKeys: [],
      baseManualPopular: true,
      baseHomepageCategoryKeys: [],
    };
    const added = {
      merchantId: "2",
      manualPopular: true,
      homepageCategoryKeys: [],
      baseManualPopular: true,
      baseHomepageCategoryKeys: [],
    };
    h.proofs.set("platform.content.draft", {
      value: { ...h.draft, recommendations: [old] },
    });
    jest
      .spyOn(h.service as any, "current")
      .mockResolvedValue({
        data: {
          ...h.draft,
          recommendations: [{ ...old, manualPopular: true }, added],
        },
        merchants: [],
      });
    const result = await h.service.get();
    expect(result.recommendations).toEqual([old, added]);
    expect(h.tx.merchant.update).not.toHaveBeenCalled();
  });
  it("saving a draft does not mutate live tags, merchants or discovery settings", async () => {
    const h = harness();
    await h.service.save(h.draft, "admin");
    expect(h.tx.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "platform.content.draft" } }),
    );
    expect(h.tx.promotionTag.update).not.toHaveBeenCalled();
    expect(h.tx.merchant.update).not.toHaveBeenCalled();
    expect(h.tx.platformSetting.deleteMany).not.toHaveBeenCalled();
  });
  it("requires a preview of the exact current draft before publishing", async () => {
    const h = harness();
    await expect(h.service.save(h.draft, "admin", true)).rejects.toThrow(
      "先预览",
    );
    expect(h.tx.promotionTag.update).not.toHaveBeenCalled();
  });
  it("publishes the renamed shared tag without changing identity or associations", async () => {
    const h = harness();
    const preview = await h.service.preview(
      h.draft,
      "北宁",
      "2026-11-05T12:00:00+07:00",
      "admin",
    );
    await h.service.save(
      { ...h.draft, previewToken: preview.previewToken },
      "admin",
      true,
    );
    expect(h.tx.promotionTag.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        nameZh: "亲子友好",
        code: "FAMILY",
        scope: "SCENE",
      }),
    });
    expect(h.tx.merchantPromotionTag.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });
  it("invalidates the preview if draft content changed or the actor differs", async () => {
    const h = harness();
    const preview = await h.service.preview(
      h.draft,
      "北宁",
      "2026-11-05T12:00:00+07:00",
      "admin",
    );
    await expect(
      h.service.save(
        { ...h.draft, previewToken: preview.previewToken },
        "other-admin",
        true,
      ),
    ).rejects.toThrow("先预览");
    h.draft.tags[0].nameZh = "新的文案";
    await expect(
      h.service.save(
        { ...h.draft, previewToken: preview.previewToken },
        "admin",
        true,
      ),
    ).rejects.toThrow("先预览");
  });
  it("rejects changes to an existing internal tag code", async () => {
    const h = harness();
    h.draft.tags[0].code = "REPLACED";
    await expect(h.service.save(h.draft, "admin")).rejects.toThrow(
      "编码、用途和关联必须保留",
    );
  });
  it("simulates another time without changing the server clock or published configuration", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-05T05:00:00Z"));
      const h = harness();
      const result = await h.service.preview(
        h.draft,
        "北宁",
        "2026-11-05T23:00:00+07:00",
        "admin",
      );
      expect(result.recommendations.period.code).toBe("EVENING");
      expect(Date.now()).toBe(Date.parse("2026-11-05T05:00:00Z"));
      expect(h.tx.promotionTag.update).not.toHaveBeenCalled();
      expect(h.tx.platformSetting.upsert).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Platform content edits do not overwrite unrelated merchant recommendations", () => {
  const tag = {
    id: "1",
    code: "FAMILY",
    nameZh: "家庭友好",
    nameVi: "Gia đình",
    scope: "SCENE" as const,
    enabled: true,
    sortOrder: 0,
  };
  function testContext(currentRec: Record<string, unknown>) {
    const live = {
      categories: [],
      topics: [],
      tags: [tag],
      recommendations: [currentRec],
      version: 0,
      baseRevision: "REVISION",
    };
    const proofs = new Map<string, unknown>();
    const db = {
      platformSetting: {
        findUnique: jest.fn(
          async ({ where }: { where: { key: string } }) =>
            proofs.get(where.key) || null,
        ),
        create: jest.fn(
          async ({ data }: { data: { key: string; value: unknown } }) => {
            proofs.set(data.key, { value: data.value });
          },
        ),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      merchantBusinessType: { findMany: jest.fn().mockResolvedValue([]) },
      promotionTag: {
        update: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      merchant: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      merchantReview: { groupBy: jest.fn().mockResolvedValue([]) },
      merchantPromotionTag: { deleteMany: jest.fn(), upsert: jest.fn() },
    };
    const service = new PlatformContentService({
      ...db,
      $transaction: (run: Function) => run(db),
    } as never);
    jest
      .spyOn(service as any, "current")
      .mockResolvedValue({ data: live, merchants: [] });
    return { db, service };
  }
  it("keeps an external recommendation change when this draft only edits tag text", async () => {
    const h = testContext({
      merchantId: "2",
      manualPopular: true,
      homepageCategoryKeys: [],
    });
    const draft = {
      categories: [],
      topics: [],
      tags: [{ ...tag, nameZh: "亲子友好" }],
      recommendations: [
        {
          merchantId: "2",
          manualPopular: false,
          homepageCategoryKeys: [],
          baseManualPopular: false,
          baseHomepageCategoryKeys: [],
        },
      ],
      version: 0,
      baseRevision: "REVISION",
    };
    const p = await h.service.preview(
      draft,
      "北宁",
      "2026-11-05T12:00:00+07:00",
      "admin",
    );
    await h.service.save(
      { ...draft, previewToken: p.previewToken },
      "admin",
      true,
    );
    expect(h.db.merchant.update).not.toHaveBeenCalled();
    expect(h.db.promotionTag.update).toHaveBeenCalled();
  });
  it("rejects conflicting changes to the same merchant recommendation", async () => {
    const h = testContext({
      merchantId: "2",
      manualPopular: false,
      homepageCategoryKeys: ["coffee_milk_tea"],
    });
    const draft = {
      categories: [],
      topics: [],
      tags: [tag],
      recommendations: [
        {
          merchantId: "2",
          manualPopular: true,
          homepageCategoryKeys: [],
          baseManualPopular: false,
          baseHomepageCategoryKeys: [],
        },
      ],
      version: 0,
      baseRevision: "REVISION",
    };
    await expect(h.service.save(draft, "admin")).rejects.toThrow(
      "推荐设置已被其他操作修改",
    );
    expect(h.db.merchant.update).not.toHaveBeenCalled();
  });
});
