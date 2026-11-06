import {
  PlatformWorkbenchService,
  merchantPublishMissing,
} from "./platform-workbench.service";
const makeMerchant = () => ({
  id: 1n,
  nameZh: "门店",
  nameVi: "Cửa hàng",
  nameEn: "",
  city: "北宁",
  province: "北宁",
  district: null,
  businessTypeId: 1n,
  businessType: { code: "CHINESE_RESTAURANT" },
  contactName: "店主",
  contactPhone: "0900000000",
  addressZh: "地址",
  addressVi: "Địa chỉ",
  addressEn: null,
  descriptionZh: "介绍",
  descriptionVi: "Giới thiệu",
  descriptionEn: null,
  latitude: 21,
  longitude: 106,
  coverUrl: "/uploads/cover.webp",
  logoUrl: null,
  openingHoursText: "09:00-22:00",
  businessHours: { monday: ["09:00-22:00"] },
  isVisibleOnClient: true,
  status: "ACTIVE",
  updatedAt: new Date("2026-11-05T00:00:00Z"),
  images: [
    {
      id: 1n,
      imageType: "STORE",
      imageUrl: "/uploads/store.webp",
      titleZh: null,
      titleVi: null,
      titleEn: null,
      sortOrder: 0,
      isVisible: true,
    },
  ],
  promotionTags: [],
  signatureDishes: [
    {
      id: 1n,
      isVisible: true,
      nameZh: "菜品",
      imageUrl: "/uploads/dish.webp",
      sortOrder: 0,
    },
  ],
  claimStatus: "UNCLAIMED",
  serviceItems: [] as any[],
  _count: { products: 0 },
});
function harness() {
  const merchant = makeMerchant();
  const tx = {
    capability: { findMany: jest.fn().mockResolvedValue([]) },
    merchant: {
      findUnique: jest.fn().mockResolvedValue(merchant),
      update: jest.fn().mockResolvedValue(merchant),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 2n }),
    },
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    merchantBusinessType: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1n,
        code: "CHINESE_RESTAURANT",
        enabled: true,
      }),
    },
    promotionTag: { count: jest.fn().mockResolvedValue(0) },
    merchantPromotionTag: { deleteMany: jest.fn(), createMany: jest.fn() },
    merchantImage: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    merchantSignatureDish: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    },
    merchantServiceItem: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    },
    merchantStaff: { updateMany: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn((run: Function) => run(tx)) };
  return {
    merchant,
    tx,
    prisma,
    service: new PlatformWorkbenchService(prisma as never),
  };
}
describe("Platform workbench publication boundary", () => {
  it("allows name + city draft creation without exposing a merchant", async () => {
    const h = harness();
    await h.service.createDraft(" 店名 ", "北宁");
    expect(h.tx.merchant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nameZh: "店名",
        city: "北宁",
        status: "PENDING",
        isVisibleOnClient: false,
      }),
    });
  });
  it("stores draft edits without changing published fields or photo associations", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    draft.profile.descriptionZh = "未发布介绍";
    draft.images = [];
    draft.signatureDishes = [
      {
        nameZh: "草稿菜品",
        imageUrl: "/uploads/new.webp",
        sortOrder: 0,
        isVisible: true,
      },
    ];
    draft.serviceItems = [
      {
        nameZh: "草稿服务",
        priceMode: "INQUIRY",
        sortOrder: 0,
        isVisible: true,
      },
    ];
    await h.service.saveDraft(1n, draft, "admin");
    expect(h.tx.platformSetting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "platform.merchant-draft.1",
        value: expect.objectContaining({ version: 1, savedBy: "admin" }),
      }),
    });
    expect(h.tx.merchant.update).not.toHaveBeenCalled();
    expect(h.tx.merchantImage.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.merchantSignatureDish.createMany).not.toHaveBeenCalled();
    expect(h.tx.merchantServiceItem.createMany).not.toHaveBeenCalled();
  });
  it("validates bilingual content before any publication write", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    draft.profile.nameVi = "";
    await expect(h.service.saveDraft(1n, draft, "admin", true)).rejects.toThrow(
      "越南文店名",
    );
    expect(h.tx.merchant.update).not.toHaveBeenCalled();
  });
  it("publishes fields, tag associations and photo associations together", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    await h.service.saveDraft(1n, draft, "admin", true);
    expect(h.tx.merchant.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        isVisibleOnClient: true,
        nameZh: "门店",
      }),
    });
    expect(h.tx.merchantImage.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({ imageUrl: "/uploads/store.webp" }),
    });
    expect(h.tx.merchantSignatureDish.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        nameZh: "菜品",
        imageUrl: "/uploads/dish.webp",
      }),
    });
    expect(h.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });
  it("publishes non-restaurant items with inquiry prices without touching the restaurant menu", async () => {
    const h = harness();
    h.merchant.businessType.code = "HOTEL";
    h.tx.merchantBusinessType.findUnique.mockResolvedValue({
      id: 1n,
      code: "HOTEL",
      enabled: true,
    });
    const draft = await h.service.draft(1n);
    draft.serviceItems = [
      {
        nameZh: "标准双人房",
        nameVi: "Phòng đôi",
        priceMode: "INQUIRY",
        sortOrder: 0,
        isVisible: true,
      },
    ];
    await h.service.saveDraft(1n, draft, "admin", true);
    expect(h.tx.merchantServiceItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          merchantId: 1n,
          nameZh: "标准双人房",
          amountVnd: null,
          priceMode: "INQUIRY",
        }),
      ],
    });
    expect(h.tx.merchantSignatureDish.deleteMany).toHaveBeenCalledWith({
      where: { merchantId: 1n, id: { notIn: [1n] } },
    });
  });
  it("rejects item IDs belonging to another merchant", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    draft.signatureDishes![0].id = "999";
    await expect(h.service.saveDraft(1n, draft, "admin", true)).rejects.toThrow(
      "招牌菜不属于该商家",
    );
    expect(h.tx.merchantSignatureDish.update).not.toHaveBeenCalled();
  });
  it("does not let independent signature entries satisfy a claimed merchant menu requirement", async () => {
    const h = harness();
    h.merchant.claimStatus = "CLAIMED";
    const draft = await h.service.draft(1n);
    draft.signatureDishes = [
      {
        nameZh: "旧独立菜品",
        imageUrl: "/uploads/dish.webp",
        isVisible: true,
        sortOrder: 0,
      },
    ];
    await expect(h.service.saveDraft(1n, draft, "admin", true)).rejects.toThrow(
      "菜单或菜品",
    );
    expect(h.tx.merchant.update).not.toHaveBeenCalled();
  });
  it("preserves independent drafts after claiming without replacing public menu products", async () => {
    const h = harness();
    h.merchant.claimStatus = "CLAIMED";
    h.merchant._count.products = 2;
    const draft = await h.service.draft(1n);
    draft.signatureDishes![0].nameZh = "认领前的独立草稿";
    await h.service.saveDraft(1n, draft, "admin", true);
    expect(h.tx.merchantSignatureDish.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({ nameZh: "认领前的独立草稿" }),
    });
    expect(h.tx.merchantServiceItem.createMany).not.toHaveBeenCalled();
  });
  it("rejects stale content when a concurrent operation changed the merchant", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    h.merchant.updatedAt = new Date("2026-11-05T01:00:00Z");
    await expect(h.service.saveDraft(1n, draft, "admin")).rejects.toThrow(
      "其他操作更新",
    );
    expect(h.tx.platformSetting.create).not.toHaveBeenCalled();
  });
  it("rejects a stale draft version", async () => {
    const h = harness();
    const draft = await h.service.draft(1n);
    h.tx.platformSetting.findUnique.mockResolvedValue({
      value: { ...draft, version: 2 },
    });
    await expect(h.service.saveDraft(1n, draft, "admin")).rejects.toThrow(
      "其他操作更新",
    );
  });
  it("restores hidden while keeping accounts disabled", async () => {
    const h = harness();
    await h.service.restore(1n);
    expect(h.tx.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: "DELETED" },
      data: { status: "ACTIVE", isVisibleOnClient: false },
    });
    expect(h.tx.merchantStaff.updateMany).toHaveBeenCalledWith({
      where: { merchantId: 1n },
      data: { status: "DISABLED" },
    });
  });
  it("requires hotel room content and a real location", () => {
    const p = {
      profile: {
        ...makeMerchant(),
        businessTypeId: "1",
        latitude: "",
        longitude: "",
      },
      images: [],
    };
    expect(merchantPublishMissing(p, "HOTEL", 0, 0)).toEqual(
      expect.arrayContaining(["房型", "精确定位"]),
    );
  });
});
