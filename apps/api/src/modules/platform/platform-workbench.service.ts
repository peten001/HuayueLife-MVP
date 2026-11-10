import { DEFAULT_DISPLAY_CAPABILITIES } from "./platform-dictionary-seed";
import { validateBusinessHoursSchedule } from "../../common/utils/merchant-hours";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PlatformDirectoryQueryDto } from "./dto/platform-directory-query.dto";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { effectiveOrderWhere } from "../orders/effective-order";
import {
  merchantContentTemplate,
  RESTAURANT_CODES,
} from "../explore/explore-content";

const editable = [
  "nameZh",
  "nameVi",
  "nameEn",
  "city",
  "province",
  "district",
  "businessTypeId",
  "contactName",
  "contactPhone",
  "addressZh",
  "addressVi",
  "addressEn",
  "descriptionZh",
  "descriptionVi",
  "descriptionEn",
  "latitude",
  "longitude",
  "coverUrl",
  "logoUrl",
  "openingHoursText",
  "businessHours",
  "isVisibleOnClient",
] as const;
const include = {
  businessType: true,
  images: { orderBy: { id: "asc" as const } },
  signatureDishes: { orderBy: { id: "asc" as const } },
  serviceItems: { orderBy: { id: "asc" as const } },
  promotionTags: { orderBy: { promotionTagId: "asc" as const } },
  _count: {
    select: {
      products: { where: { status: { in: ["ON_SALE", "SOLD_OUT"] } } },
      serviceItems: { where: { isVisible: true } },
    },
  },
} satisfies Prisma.MerchantInclude;
type Merchant = Prisma.MerchantGetPayload<{ include: typeof include }>;
export type DraftImage = {
  id?: string;
  imageType: string;
  imageUrl: string;
  titleZh?: string;
  titleVi?: string;
  titleEn?: string;
  sortOrder: number;
  isVisible: boolean;
};
export type DraftDisplayItem = {
  id?: string;
  clientKey?: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  imageUrl?: string | null;
  sortOrder: number;
  isVisible: boolean;
  descriptionZh?: string | null;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  durationMinutes?: number | null;
  priceMode?: "INQUIRY" | "FIXED" | "FROM";
  amountVnd?: string | null;
  unit?: string | null;
};
export type MerchantDraft = {
  profile: Record<string, unknown>;
  tagIds: string[];
  images: DraftImage[];
  signatureDishes?: DraftDisplayItem[];
  serviceItems?: DraftDisplayItem[];
  version: number;
  baseRevision: string;
  savedAt?: string;
  savedBy?: string;
};
const json = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
const revision = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(json(value)))
    .digest("hex");

export function merchantPublishMissing(
  draft: Pick<
    MerchantDraft,
    "profile" | "images" | "signatureDishes" | "serviceItems"
  >,
  typeCode: string | null,
  productCount: number,
  signatureCount: number,
  serviceCount = 0,
  menuManaged = false,
) {
  const p = draft.profile;
  const required = [
    ["nameZh", "中文店名"],
    ["nameVi", "越南文店名"],
    ["city", "城市"],
    ["businessTypeId", "行业"],
    ["contactName", "联系人"],
    ["contactPhone", "联系电话"],
    ["addressZh", "中文地址"],
    ["addressVi", "越南文地址"],
    ["coverUrl", "封面"],
    ["descriptionZh", "中文介绍"],
    ["descriptionVi", "越南文介绍"],
  ] as const;
  const missing = required
    .filter(([key]) => !String(p[key] ?? "").trim())
    .map(([, label]) => label as string);
  const lat = p.latitude;
  const lng = p.longitude;
  if (
    lat === null ||
    lat === "" ||
    lat === undefined ||
    lng === null ||
    lng === "" ||
    lng === undefined ||
    !Number.isFinite(Number(lat)) ||
    !Number.isFinite(Number(lng)) ||
    Math.abs(Number(lat)) > 90 ||
    Math.abs(Number(lng)) > 180 ||
    (Number(lat) === 0 && Number(lng) === 0)
  )
    missing.push("精确定位");
  if (
    !String(p.openingHoursText ?? "").trim() &&
    (!p.businessHours || !Object.keys(p.businessHours as object).length)
  )
    missing.push("营业时间");
  if (menuManaged) signatureCount = 0;
  else if (draft.signatureDishes)
    signatureCount = draft.signatureDishes.filter(
      (item) => item.isVisible && item.nameZh?.trim() && item.imageUrl?.trim(),
    ).length;
  if (draft.serviceItems)
    serviceCount = draft.serviceItems.filter(
      (item) => item.isVisible && item.nameZh?.trim(),
    ).length;
  const template = merchantContentTemplate(typeCode);
  const content = draft.images.filter(
    (image) => image.isVisible && ["PRODUCT", "MENU"].includes(image.imageType),
  );
  if (
    template === "RESTAURANT" &&
    productCount + signatureCount + content.length === 0
  )
    missing.push("菜单或菜品");
  if (
    template !== "RESTAURANT" &&
    content.filter((image) => image.titleZh?.trim()).length + serviceCount === 0
  )
    missing.push(
      typeCode === "HOTEL"
        ? "房型"
        : template === "SERVICE"
          ? "服务项目"
          : "商品或展示项目",
    );
  return missing;
}

export function incompleteMerchantWhere(): Prisma.MerchantWhereInput {
  return {
    OR: [
      { nameZh: "" },
      { nameVi: null },
      { nameVi: "" },
      { city: "" },
      { businessTypeId: null },
      { contactName: "" },
      { contactPhone: "" },
      { addressZh: null },
      { addressZh: "" },
      { addressVi: null },
      { addressVi: "" },
      { descriptionZh: null },
      { descriptionZh: "" },
      { descriptionVi: null },
      { descriptionVi: "" },
      { coverUrl: null },
      { coverUrl: "" },
      { AND: [{ latitude: 0 }, { longitude: 0 }] },
      { latitude: { lt: -90 } },
      { latitude: { gt: 90 } },
      { longitude: { lt: -180 } },
      { longitude: { gt: 180 } },
      {
        AND: [
          { OR: [{ openingHoursText: null }, { openingHoursText: "" }] },
          { businessHours: { equals: {} } },
        ],
      },
      {
        businessType: { code: { in: [...RESTAURANT_CODES] } },
        products: { none: { status: { in: ["ON_SALE", "SOLD_OUT"] } } },
        OR: [
          { claimStatus: "CLAIMED" },
          { signatureDishes: { none: { isVisible: true } } },
        ],
        images: {
          none: { isVisible: true, imageType: { in: ["PRODUCT", "MENU"] } },
        },
      },
      {
        businessType: { code: { notIn: [...RESTAURANT_CODES] } },
        serviceItems: { none: { isVisible: true } },
        images: {
          none: {
            isVisible: true,
            imageType: { in: ["PRODUCT", "MENU"] },
            titleZh: { not: "" },
          },
        },
      },
    ],
  };
}

@Injectable()
export class PlatformWorkbenchService {
  constructor(private readonly prisma: PrismaService) {}
  private directoryWhere(
    query: PlatformDirectoryQueryDto,
  ): Prisma.MerchantWhereInput {
    const keyword = query.keyword?.trim();
    return {
      status: query.status || { not: "DELETED" },
      city: query.city || undefined,
      province: query.region || undefined,
      district: query.district || undefined,
      businessTypeId: query.businessTypeId
        ? BigInt(query.businessTypeId)
        : undefined,
      claimStatus: query.claimStatus || undefined,
      ...(query.merchantMode
        ? {
            merchantMode: {
              in:
                query.merchantMode === "DISPLAY"
                  ? (["DISPLAY", "DISPLAY_ONLY", "PRODUCT_DISPLAY"] as const)
                  : (["MANAGED", "ONLINE_ORDER", "QR_ORDER"] as const),
            },
          }
        : {}),
      ...(query.view === "visible"
        ? { isVisibleOnClient: true }
        : query.view === "hidden"
          ? { isVisibleOnClient: false }
          : {}),
      AND: [
        ...(keyword
          ? [
              {
                OR: [
                  { nameZh: { contains: keyword } },
                  { nameVi: { contains: keyword } },
                  { contactPhone: { contains: keyword } },
                ],
              },
            ]
          : []),
        ...(query.view === "incomplete"
          ? [incompleteMerchantWhere()]
          : query.view === "complete"
            ? [{ NOT: incompleteMerchantWhere() }]
            : query.view === "missing_coords"
              ? [{ latitude: 0, longitude: 0 }]
              : query.view === "missing_images"
                ? [{ OR: [{ coverUrl: null }, { coverUrl: "" }] }]
                : []),
        ...(query.popular
          ? [
              query.popular === "yes"
                ? {
                    OR: [
                      { manualPopular: true },
                      { homepageCategoryKeys: { contains: '"popular_food"' } },
                      {
                        promotionTags: {
                          some: { promotionTag: { code: "HOT_FOOD" } },
                        },
                      },
                    ],
                  }
                : {
                    NOT: {
                      OR: [
                        { manualPopular: true },
                        {
                          homepageCategoryKeys: { contains: '"popular_food"' },
                        },
                        {
                          promotionTags: {
                            some: { promotionTag: { code: "HOT_FOOD" } },
                          },
                        },
                      ],
                    },
                  },
            ]
          : []),
      ],
    };
  }
  async directory(query: PlatformDirectoryQueryDto) {
    const where = this.directoryWhere(query);
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const [total, items] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        include,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: "asc" }, { id: "desc" }],
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((m) => ({
        id: String(m.id),
        nameZh: m.nameZh,
        nameVi: m.nameVi,
        city: m.city,
        contactName: m.contactName,
        contactPhone: m.contactPhone,
        coverUrl: m.coverUrl,
        addressZh: m.addressZh,
        businessType: m.businessType?.nameZh,
        status: m.status,
        isVisibleOnClient: m.isVisibleOnClient,
        claimStatus: m.claimStatus,
        merchantMode: m.merchantMode,
        updatedAt: m.updatedAt,
        missing: merchantPublishMissing(
          this.snapshot(m),
          m.businessType?.code ?? null,
          m._count.products,
          m.signatureDishes.filter((d) => d.isVisible).length,
          m._count.serviceItems ?? 0,
          m.claimStatus === "CLAIMED",
        ),
      })),
    };
  }
  async exportDirectory(query: PlatformDirectoryQueryDto) {
    const rows = await this.prisma.merchant.findMany({
      where: this.directoryWhere(query),
      select: {
        id: true,
        nameZh: true,
        nameVi: true,
        city: true,
        province: true,
        district: true,
        contactName: true,
        contactPhone: true,
        addressZh: true,
        isVisibleOnClient: true,
        status: true,
        claimStatus: true,
        businessType: { select: { nameZh: true } },
      },
      orderBy: { id: "desc" },
    });
    const cell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const values = [
      [
        "商家编号",
        "中文店名",
        "越南文店名",
        "城市",
        "运营区域",
        "区县",
        "行业",
        "联系人",
        "电话",
        "地址",
        "对外展示",
        "经营状态",
        "认领状态",
      ],
      ...rows.map((m) => [
        String(m.id),
        m.nameZh,
        m.nameVi,
        m.city,
        m.province,
        m.district,
        m.businessType?.nameZh,
        m.contactName,
        m.contactPhone,
        m.addressZh,
        m.isVisibleOnClient ? "是" : "否",
        m.status,
        m.claimStatus,
      ]),
    ];
    return {
      filename: "YunQiao-merchants.csv",
      content:
        "\uFEFF" + values.map((row) => row.map(cell).join(",")).join("\r\n"),
    };
  }
  async quick(id: bigint) {
    const m = await this.prisma.merchant.findUnique({ where: { id }, include });
    if (!m || m.status === "DELETED") throw new NotFoundException("商家不存在");
    return {
      id: String(m.id),
      nameZh: m.nameZh,
      nameVi: m.nameVi,
      city: m.city,
      contactName: m.contactName,
      contactPhone: m.contactPhone,
      coverUrl: m.coverUrl,
      addressZh: m.addressZh,
      businessType: m.businessType?.nameZh,
      status: m.status,
      isVisibleOnClient: m.isVisibleOnClient,
      claimStatus: m.claimStatus,
      updatedAt: m.updatedAt,
      missing: merchantPublishMissing(
        this.snapshot(m),
        m.businessType?.code ?? null,
        m._count.products,
        m.signatureDishes.filter((i) => i.isVisible).length,
        m._count.serviceItems ?? 0,
        m.claimStatus === "CLAIMED",
      ),
    };
  }
  async selection(query: PlatformDirectoryQueryDto, actor: string) {
    const items = await this.prisma.merchant.findMany({
      where: this.directoryWhere(query),
      select: { id: true },
    });
    await this.prisma.platformSetting.deleteMany({
      where: {
        key: { startsWith: "platform.selection." },
        createdAt: { lt: new Date(Date.now() - 900000) },
      },
    });
    const token = randomUUID();
    await this.prisma.platformSetting.create({
      data: {
        key: `platform.selection.${token}`,
        value: json({
          ids: items.map((m) => String(m.id)),
          actor,
          expiresAt: Date.now() + 900000,
        }),
      },
    });
    return { token, total: items.length };
  }
  async bulk(
    body: { ids?: string[]; token?: string; action?: string },
    actor: string,
  ) {
    if (!["hide", "trash"].includes(body.action || ""))
      throw new BadRequestException("不支持的批量操作");
    let ids = body.ids;
    if (body.token) {
      const snapshot = await this.prisma.platformSetting.findUnique({
        where: { key: `platform.selection.${body.token}` },
      });
      const value = snapshot?.value as
        | { ids: string[]; actor: string; expiresAt: number }
        | undefined;
      if (!value || value.actor !== actor || value.expiresAt < Date.now())
        throw new ConflictException("选择范围已过期，请重新选择");
      ids = value.ids;
    }
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => !/^\d+$/.test(id))
    )
      throw new BadRequestException("请选择商家");
    const results: Array<{ id: string; ok: boolean; message?: string }> = [];
    for (const id of [...new Set(ids)]) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const m = await tx.merchant.findUnique({
            where: { id: BigInt(id) },
            select: { status: true },
          });
          if (!m || m.status === "DELETED")
            throw new ConflictException("商家不存在或已在回收站");
          await tx.merchant.update({
            where: { id: BigInt(id) },
            data: {
              isVisibleOnClient: false,
              ...(body.action === "trash"
                ? { status: "DELETED" as const }
                : {}),
            },
          });
          if (body.action === "trash")
            await tx.merchantStaff.updateMany({
              where: { merchantId: BigInt(id) },
              data: { status: "DISABLED" },
            });
        });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({
          id,
          ok: false,
          message: error instanceof Error ? error.message : "操作失败",
        });
      }
    }
    return { results };
  }
  async search(raw: string) {
    const q = String(raw ?? "")
      .trim()
      .slice(0, 120);
    if (q.length < 2) return { items: [] };
    const [merchants, orders, users] = await Promise.all([
      this.prisma.merchant.findMany({
        where: {
          status: { not: "DELETED" },
          OR: [
            { nameZh: { contains: q } },
            { nameVi: { contains: q } },
            { contactPhone: { contains: q } },
          ],
        },
        select: { id: true, nameZh: true, city: true },
        take: 8,
      }),
      this.prisma.order.findMany({
        where: effectiveOrderWhere({
          OR: [{ orderNo: { contains: q } }, { contactPhone: { contains: q } }],
        }),
        select: { id: true, orderNo: true, contactPhone: true },
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.user.findMany({
        where: {
          OR: [{ nickname: { contains: q } }, { phone: { contains: q } }],
        },
        select: { id: true, nickname: true, phone: true },
        take: 8,
      }),
    ]);
    return {
      items: [
        ...merchants.map((m) => ({
          id: String(m.id),
          kind: "商家",
          label: m.nameZh,
          detail: m.city,
          path: `/platform/merchants?quick=${m.id}`,
        })),
        ...orders.map((o) => ({
          id: String(o.id),
          kind: "订单",
          label: o.orderNo,
          detail: o.contactPhone ?? "",
          path: `/platform/orders?orderNo=${encodeURIComponent(o.orderNo)}`,
        })),
        ...users.map((u) => ({
          id: String(u.id),
          kind: "用户",
          label: u.nickname || u.phone || String(u.id),
          detail: u.phone ?? "",
          path: `/platform/users?userId=${u.id}`,
        })),
      ],
    };
  }
  async queue() {
    const [pending, reviews, merchants] = await Promise.all([
      this.prisma.order.count({
        where: effectiveOrderWhere({
          status: "PENDING_ACCEPTANCE",
          createdAt: { lt: new Date(Date.now() - 600000) },
        }),
      }),
      this.prisma.merchantReview.count({ where: { status: "PENDING_REVIEW" } }),
      this.prisma.merchant.count({
        where: { status: { not: "DELETED" }, AND: [incompleteMerchantWhere()] },
      }),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      items: [
        {
          label: "长时间未接单",
          count: pending,
          path: `/platform/orders?status=PENDING_ACCEPTANCE&pendingBefore=${encodeURIComponent(new Date(Date.now() - 600000).toISOString())}`,
        },
        {
          label: "待审核评价",
          count: reviews,
          path: "/platform/reviews?status=PENDING_REVIEW",
        },
        {
          label: "待完善商家",
          count: merchants,
          path: "/platform/merchants?incomplete=1",
        },
      ],
    };
  }
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { api: "ok", database: "ok", checkedAt: new Date().toISOString() };
  }
  async createDraft(nameZh = "", city = "") {
    const capabilities = await this.prisma.capability.findMany({
      where: { enabled: true },
      select: { id: true, code: true },
    });
    const item = await this.prisma.merchant.create({
      data: {
        capabilities: {
          create: capabilities.map((capability) => ({
            capabilityId: capability.id,
            isEnabled: Boolean(
              (DEFAULT_DISPLAY_CAPABILITIES as Record<string, boolean>)[
                capability.code
              ],
            ),
          })),
        },
        nameZh: nameZh.trim() || "未命名商家",
        city: city.trim(),
        province: city.trim(),
        contactName: "",
        contactPhone: "",
        addressDetail: "",
        latitude: 0,
        longitude: 0,
        businessHours: {},
        merchantMode: "DISPLAY",
        status: "PENDING",
        isVisibleOnClient: false,
        dineInEnabled: false,
        pickupEnabled: false,
        deliveryEnabled: false,
        pickupReservationEnabled: false,
        dineInReservationEnabled: false,
      },
    });
    return { id: String(item.id) };
  }
  private snapshot(m: Merchant): MerchantDraft {
    return {
      profile: Object.fromEntries(
        editable.map((key) => [
          key,
          key === "businessTypeId"
            ? (m[key]?.toString() ?? "")
            : key === "latitude" || key === "longitude"
              ? Number(m.latitude) === 0 && Number(m.longitude) === 0
                ? ""
                : String(m[key])
              : (m[key] ?? ""),
        ]),
      ),
      signatureDishes: m.signatureDishes.map((item) => ({
        id: String(item.id),
        nameZh: item.nameZh || "",
        nameVi: item.nameVi || "",
        nameEn: item.nameEn || "",
        imageUrl: item.imageUrl || "",
        sortOrder: item.sortOrder || 0,
        isVisible: item.isVisible,
      })),
      serviceItems: (m.serviceItems || []).map((item) => ({
        id: String(item.id),
        nameZh: item.nameZh,
        nameVi: item.nameVi || "",
        nameEn: item.nameEn || "",
        imageUrl: item.imageUrl || "",
        descriptionZh: item.descriptionZh || "",
        descriptionVi: item.descriptionVi || "",
        descriptionEn: item.descriptionEn || "",
        durationMinutes: item.durationMinutes,
        priceMode: item.priceMode as "INQUIRY" | "FIXED" | "FROM",
        amountVnd: item.amountVnd?.toString() || null,
        unit: item.unit || "",
        sortOrder: item.sortOrder,
        isVisible: item.isVisible,
      })),
      tagIds: m.promotionTags.map((t) => String(t.promotionTagId)),
      images: m.images.map((i) => ({
        id: String(i.id),
        imageType: i.imageType,
        imageUrl: i.imageUrl,
        titleZh: i.titleZh ?? "",
        titleVi: i.titleVi ?? "",
        titleEn: i.titleEn ?? "",
        sortOrder: i.sortOrder,
        isVisible: i.isVisible,
      })),
      version: 0,
      baseRevision: revision(m),
    };
  }
  async draft(id: bigint) {
    const [merchant, saved] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id }, include }),
      this.prisma.platformSetting.findUnique({
        where: { key: `platform.merchant-draft.${id}` },
      }),
    ]);
    if (!merchant || merchant.status === "DELETED")
      throw new NotFoundException("商家不存在或已移入回收站");
    const draft = saved
      ? (saved.value as unknown as MerchantDraft)
      : this.snapshot(merchant);
    return {
      ...draft,
      contentCounts: {
        menu: merchant._count.products,
        services: merchant._count.serviceItems ?? 0,
      },
      currentRevision: revision(merchant),
      current: this.snapshot(merchant),
      merchantId: String(id),
      status: merchant.status,
      claimStatus: merchant.claimStatus,
      currentlyVisible: merchant.isVisibleOnClient,
      missing: merchantPublishMissing(
        draft,
        merchant.businessType?.code ?? null,
        merchant._count.products,
        merchant.signatureDishes.filter((i) => i.isVisible).length,
        merchant._count.serviceItems ?? 0,
        merchant.claimStatus === "CLAIMED",
      ),
      hasDraft: !!saved,
      conflicted: draft.baseRevision !== revision(merchant),
    };
  }
  async saveDraft(
    id: bigint,
    input: MerchantDraft,
    actor: string,
    publish = false,
  ) {
    this.validateDraft(input);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.findUnique({
            where: { id },
            include,
          });
          if (!merchant || merchant.status === "DELETED")
            throw new NotFoundException("商家不存在");
          const key = `platform.merchant-draft.${id}`;
          const saved = await tx.platformSetting.findUnique({ where: { key } });
          const old = saved?.value as unknown as MerchantDraft | undefined;
          if (
            (old?.version ?? 0) !== input.version ||
            input.baseRevision !== revision(merchant)
          )
            throw new ConflictException(
              "资料已被其他操作更新，请重新加载后核对",
            );
          const currentProfile = this.snapshot(merchant).profile;
          const profile = Object.fromEntries(
            editable
              .map((field) => [field, field in input.profile
                ? input.profile[field]
                : currentProfile[field]]),
          );
          const draft = {
            signatureDishes:
              input.signatureDishes ?? this.snapshot(merchant).signatureDishes,
            serviceItems:
              input.serviceItems ?? this.snapshot(merchant).serviceItems,
            tagIds: input.tagIds,
            images: input.images,
            baseRevision: input.baseRevision,
            profile,
            version: input.version + 1,
            savedAt: new Date().toISOString(),
            savedBy: actor,
          };
          if (!publish) {
            if (saved)
              await tx.platformSetting.update({
                where: { key },
                data: { value: json(draft) },
              });
            else
              await tx.platformSetting.create({
                data: { key, value: json(draft) },
              });
            return { ...draft, published: false };
          }
          const type = /^\d+$/.test(String(profile.businessTypeId))
            ? await tx.merchantBusinessType.findUnique({
                where: { id: BigInt(String(profile.businessTypeId)) },
              })
            : null;
          if (profile.businessTypeId && !type)
            throw new BadRequestException("所选行业不存在，请重新选择或留空");
          const data: Prisma.MerchantUpdateInput = {};
          for (const field of editable) {
            if (
              [
                "businessTypeId",
                "latitude",
                "longitude",
                "businessHours",
                "isVisibleOnClient",
              ].includes(field)
            )
              continue;
            if (profile[field] !== undefined)
              (data as Record<string, unknown>)[field] = String(
                profile[field] ?? "",
              ).trim();
          }
          data.businessType = type ? { connect: { id: type.id } } : { disconnect: true };
          data.nameZh = String(profile.nameZh ?? "").trim() || "未命名商家";
          const contentType = merchantContentTemplate(type?.code, merchant.merchantType);
          data.merchantType = type ? (
            contentType === "SERVICE" || contentType === "GENERAL"
              ? "SERVICE"
              : contentType === "RETAIL"
                ? "RETAIL"
                : "RESTAURANT") : merchant.merchantType;
          if (
            merchant.status === "PENDING" &&
            !merchant.homepageCategoryKeys?.includes('"')
          ) {
            const keys: Record<string, string> = {
              CHINESE_RESTAURANT: "chinese_dining",
              NOODLE_SNACK: "noodles_snacks",
              VIETNAMESE_FOOD: "vietnamese_food",
              COFFEE_TEA: "coffee_milk_tea",
              FLOWER_GIFT: "flowers_gifts",
              FRUIT_FRESH: "fresh_fruit",
              CONVENIENCE_MARKET: "convenience_store",
            };
            data.homepageCategoryKeys = JSON.stringify(
              type && keys[type.code] ? [keys[type.code]] : [],
            );
          }
          const hasLocation = profile.latitude !== "" && profile.latitude != null
            && profile.longitude !== "" && profile.longitude != null;
          data.latitude = hasLocation ? Number(profile.latitude) : 0;
          data.longitude = hasLocation ? Number(profile.longitude) : 0;
          try {
            data.businessHours = json(
              validateBusinessHoursSchedule(profile.businessHours || {}),
            );
          } catch {
            throw new BadRequestException(
              "营业时间格式不正确，请核对每周时段及跨天重叠",
            );
          }
          data.addressDetail = String(profile.addressZh ?? "");
          data.province = String(merchant.status === "PENDING" || String(profile.city ?? "") !== merchant.city
            ? profile.city ?? ""
            : profile.province ?? profile.city ?? "").trim();
          data.isVisibleOnClient = profile.isVisibleOnClient !== false;
          data.status =
            merchant.status === "PENDING" ? "ACTIVE" : merchant.status;
          data.notice = String(profile.descriptionZh || "");
          await tx.merchant.update({ where: { id }, data });
          const tagIds = [...new Set(input.tagIds)].map(BigInt);
          const tags = await tx.promotionTag.count({
            where: { id: { in: tagIds } },
          });
          if (tags !== tagIds.length)
            throw new BadRequestException("部分标签已失效，请刷新");
          await tx.merchantPromotionTag.deleteMany({
            where: { merchantId: id },
          });
          if (tagIds.length)
            await tx.merchantPromotionTag.createMany({
              data: tagIds.map((promotionTagId) => ({
                merchantId: id,
                promotionTagId,
              })),
            });
          // Update associations only; old image files/URLs are never deleted or re-encoded.
          const currentIds = new Set(
            merchant.images.map((image) => String(image.id)),
          );
          const retained = input.images
            .filter((image) => image.id)
            .map((image) => BigInt(image.id!));
          if (
            input.images.some((image) => image.id && !currentIds.has(image.id))
          )
            throw new BadRequestException("图片不属于该商家");
          await tx.merchantImage.deleteMany({
            where: { merchantId: id, id: { notIn: retained } },
          });
          for (const image of input.images) {
            const imageId = image.id;
            const values = {
              imageType: image.imageType,
              imageUrl: image.imageUrl,
              titleZh: image.titleZh || null,
              titleVi: image.titleVi || null,
              titleEn: image.titleEn || null,
              sortOrder: image.sortOrder,
              isVisible: image.isVisible,
            };
            if (imageId)
              await tx.merchantImage.update({
                where: { id: BigInt(imageId) },
                data: values,
              });
            else
              await tx.merchantImage.create({
                data: { ...values, merchantId: id },
              });
          }
          // Keep independent display records when a merchant changes industry or claims its menu.
          // Public restaurant menu products are owned by the merchant and never written here.
          if (draft.signatureDishes) {
            const owned = new Set(
              merchant.signatureDishes.map((item) => String(item.id)),
            );
            if (
              draft.signatureDishes.some(
                (item) => item.id && !owned.has(item.id),
              )
            )
              throw new BadRequestException("招牌菜不属于该商家");
            await tx.merchantSignatureDish.deleteMany({
              where: {
                merchantId: id,
                id: {
                  notIn: draft.signatureDishes
                    .filter((item) => item.id)
                    .map((item) => BigInt(item.id!)),
                },
              },
            });
            const added: Prisma.MerchantSignatureDishCreateManyInput[] = [];
            for (const item of draft.signatureDishes) {
              const values = {
                nameZh: item.nameZh.trim(),
                nameVi: item.nameVi?.trim() || null,
                nameEn: item.nameEn?.trim() || null,
                imageUrl: item.imageUrl || "",
                sortOrder: item.sortOrder,
                isVisible: item.isVisible,
              };
              if (item.id)
                await tx.merchantSignatureDish.update({
                  where: { id: BigInt(item.id) },
                  data: values,
                });
              else added.push({ ...values, merchantId: id });
            }
            if (added.length)
              await tx.merchantSignatureDish.createMany({ data: added });
          }
          if (draft.serviceItems) {
            const owned = new Set(
              (merchant.serviceItems || []).map((item) => String(item.id)),
            );
            if (
              draft.serviceItems.some((item) => item.id && !owned.has(item.id))
            )
              throw new BadRequestException("服务项目不属于该商家");
            await tx.merchantServiceItem.deleteMany({
              where: {
                merchantId: id,
                id: {
                  notIn: draft.serviceItems
                    .filter((item) => item.id)
                    .map((item) => BigInt(item.id!)),
                },
              },
            });
            const added: Prisma.MerchantServiceItemCreateManyInput[] = [];
            for (const item of draft.serviceItems) {
              const values = {
                nameZh: item.nameZh.trim(),
                nameVi: item.nameVi?.trim() || null,
                nameEn: item.nameEn?.trim() || null,
                descriptionZh: item.descriptionZh?.trim() || null,
                descriptionVi: item.descriptionVi?.trim() || null,
                descriptionEn: item.descriptionEn?.trim() || null,
                imageUrl: item.imageUrl || null,
                durationMinutes: item.durationMinutes ?? null,
                priceMode: item.amountVnd ? item.priceMode || "INQUIRY" : "INQUIRY",
                amountVnd:
                  item.priceMode === "INQUIRY" || !item.amountVnd
                    ? null
                    : BigInt(item.amountVnd),
                unit: item.unit?.trim() || null,
                sortOrder: item.sortOrder,
                isVisible: item.isVisible,
              };
              if (item.id)
                await tx.merchantServiceItem.update({
                  where: { id: BigInt(item.id) },
                  data: values,
                });
              else added.push({ ...values, merchantId: id });
            }
            if (added.length)
              await tx.merchantServiceItem.createMany({ data: added });
          }
          if (saved) await tx.platformSetting.delete({ where: { key } });
          await tx.platformSetting.upsert({
            where: { key: `platform.merchant-published.${id}` },
            create: {
              key: `platform.merchant-published.${id}`,
              value: json({
                at: draft.savedAt,
                by: actor,
                version: draft.version,
              }),
            },
            update: {
              value: json({
                at: draft.savedAt,
                by: actor,
                version: draft.version,
              }),
            },
          });
          return { published: true, id: String(id) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code)
      )
        throw new ConflictException("资料已被其他操作更新，请重新加载后核对");
      throw error;
    }
  }
  private validateDraft(input: MerchantDraft) {
    if (
      !input ||
      !input.profile ||
      !Number.isInteger(input.version) ||
      input.version < 0 ||
      typeof input.baseRevision !== "string" ||
      !Array.isArray(input.tagIds) ||
      !Array.isArray(input.images)
    )
      throw new BadRequestException("草稿格式不正确");
    const limits: Record<string, number> = {
      nameZh: 120,
      nameVi: 120,
      nameEn: 120,
      city: 80,
      province: 80,
      district: 80,
      contactName: 64,
      contactPhone: 32,
      addressZh: 255,
      addressVi: 255,
      addressEn: 255,
      coverUrl: 500,
      logoUrl: 500,
      openingHoursText: 255,
      descriptionZh: 20000,
      descriptionVi: 20000,
      descriptionEn: 20000,
    };
    for (const [field, max] of [["latitude", 90], ["longitude", 180]] as const) {
      const value = input.profile[field];
      if (value != null && value !== "" && (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > max))
        throw new BadRequestException("定位格式不正确，可以留空后补");
    }
    for (const [field, max] of Object.entries(limits))
      if (
        input.profile[field] != null &&
        (typeof input.profile[field] !== "string" ||
          (input.profile[field] as string).length > max)
      )
        throw new BadRequestException(`${field} 内容过长或格式不正确`);
    if (input.tagIds.some((id) => !/^\d+$/.test(id)))
      throw new BadRequestException("标签格式不正确");
    if (
      input.profile.businessTypeId &&
      !/^\d+$/.test(String(input.profile.businessTypeId))
    )
      throw new BadRequestException("行业格式不正确");
    if (
      input.profile.isVisibleOnClient !== undefined &&
      typeof input.profile.isVisibleOnClient !== "boolean"
    )
      throw new BadRequestException("展示状态不正确");
    for (const items of [input.signatureDishes, input.serviceItems]) {
      if (items === undefined) continue;
      if (!Array.isArray(items))
        throw new BadRequestException("展示项目格式不正确");
      const ids = items.filter((item) => item?.id).map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException("存在重复展示项目");
      for (const item of items) {
        if (
          !item ||
          typeof item.nameZh !== "string" ||
          !Number.isInteger(item.sortOrder) ||
          item.sortOrder < 0 ||
          typeof item.isVisible !== "boolean" ||
          (item.id && !/^\d+$/.test(item.id))
        )
          throw new BadRequestException("展示项目格式不正确");
        const limits: Record<string, number> = {
          nameZh: 120,
          nameVi: 120,
          nameEn: 120,
          imageUrl: 500,
          descriptionZh: 500,
          descriptionVi: 500,
          descriptionEn: 500,
          unit: 32,
        };
        for (const [key, max] of Object.entries(limits)) {
          const value = (item as unknown as Record<string, unknown>)[key];
          if (
            value != null &&
            (typeof value !== "string" || value.length > max)
          )
            throw new BadRequestException("展示项目文字过长或格式不正确");
        }
        if (item.imageUrl && !/^(\/uploads\/|https?:\/\/)/.test(item.imageUrl))
          throw new BadRequestException("项目图片地址无效");
        if (
          (item.priceMode &&
            !["INQUIRY", "FIXED", "FROM"].includes(item.priceMode)) ||
          (item.amountVnd && !/^\d{1,12}$/.test(item.amountVnd)) ||
          (item.durationMinutes != null &&
            (!Number.isInteger(item.durationMinutes) ||
              item.durationMinutes < 1 ||
              item.durationMinutes > 1440))
        )
          throw new BadRequestException("项目价格或时长格式不正确");
      }
    }
    for (const image of input.images) {
      if (
        !image ||
        ![
          "STORE",
          "ENVIRONMENT",
          "PRODUCT",
          "MENU",
          "LOGO",
          "COVER",
          "LICENSE",
        ].includes(image.imageType) ||
        typeof image.imageUrl !== "string" ||
        image.imageUrl.length > 500 ||
        !/^(\/uploads\/|https?:\/\/)/.test(image.imageUrl) ||
        !Number.isInteger(image.sortOrder) ||
        typeof image.isVisible !== "boolean" ||
        (image.id && !/^\d+$/.test(image.id))
      )
        throw new BadRequestException("图片内容不正确");
      for (const field of ["titleZh", "titleVi", "titleEn"] as const)
        if (
          image[field] &&
          (typeof image[field] !== "string" || image[field]!.length > 120)
        )
          throw new BadRequestException("图片标题过长");
    }
  }
  async trash() {
    const items = await this.prisma.merchant.findMany({
      where: { status: "DELETED" },
      select: { id: true, nameZh: true, city: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    return { items: items.map((i) => ({ ...i, id: String(i.id) })) };
  }
  async restore(id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.merchant.updateMany({
        where: { id, status: "DELETED" },
        data: { status: "ACTIVE", isVisibleOnClient: false },
      });
      if (!changed.count) throw new ConflictException("商家已恢复或不存在");
      // Deliberately keep staff disabled. Recovery never reopens login or publication.
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: "DISABLED" },
      });
      await tx.platformSetting.deleteMany({
        where: { key: `platform.merchant-draft.${id}` },
      });
      return { id: String(id), isVisibleOnClient: false };
    });
  }
  async tagImpact(id: bigint) {
    const [total, items] = await Promise.all([
      this.prisma.merchantPromotionTag.count({ where: { promotionTagId: id } }),
      this.prisma.merchantPromotionTag.findMany({
        where: { promotionTagId: id },
        include: {
          merchant: { select: { id: true, nameZh: true, city: true } },
        },
        take: 50,
      }),
    ]);
    return {
      total,
      items: items.map((i) => ({ ...i.merchant, id: String(i.merchant.id) })),
    };
  }
}
