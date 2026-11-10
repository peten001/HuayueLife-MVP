import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import {
  DEFAULT_EXPLORE_CATEGORIES,
  ExploreCategory,
  ExploreTopic,
  merchantContentTemplate,
} from "../explore/explore-content";
import { ExploreCategoryDto, ExploreTopicDto } from "../explore/explore.dto";
import { assertMediaUrl, validTopicTarget } from "../explore/explore.service";
import { UpsertPromotionTagDto } from "./dto/platform-dictionary.dto";
import { RESERVED_PROMOTION_TAG_CODES } from "./platform-dictionaries.service";
import {
  HOMEPAGE_CATEGORY_KEYS,
  parseHomepageCategoryKeys,
  RETIRED_HOMEPAGE_CATEGORY_KEYS,
} from "../shared/homepage-category-keys";
import { buildHomeRecommendations } from "../public-merchants/home-recommendations";
import { isMerchantOpen } from "../../common/utils/merchant-hours";
type Tag = UpsertPromotionTagDto & {
  id: string;
  merchantReferenceCount?: number;
  reserved?: boolean;
};
type Recommendation = {
  merchantId: string;
  manualPopular: boolean;
  homepageCategoryKeys: string[];
  baseManualPopular?: boolean;
  baseHomepageCategoryKeys?: string[];
};
export type ContentDraft = {
  categories: ExploreCategory[];
  topics: ExploreTopic[];
  tags: Tag[];
  recommendations: Recommendation[];
  version: number;
  baseRevision: string;
  savedAt?: string;
  savedBy?: string;
};
const json = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  ) as Prisma.InputJsonValue;
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(json(value)))
    .digest("hex");
const DRAFT_KEY = "platform.content.draft";
@Injectable()
export class PlatformContentService {
  constructor(private readonly prisma: PrismaService) {}
  private async current(db: Prisma.TransactionClient = this.prisma) {
    const [settings, tags, merchants] = await Promise.all([
      db.platformSetting.findMany({
        where: {
          OR: [
            { key: { startsWith: "explore.category." } },
            { key: { startsWith: "explore.topic." } },
          ],
        },
        orderBy: { key: "asc" },
      }),
      db.promotionTag.findMany({
        include: { _count: { select: { merchants: true } } },
        orderBy: { id: "asc" },
      }),
      db.merchant.findMany({
        where: { status: { not: "DELETED" } },
        select: {
          id: true,
          nameZh: true,
          nameVi: true,
          province: true,
          city: true,
          coverUrl: true,
          manualPopular: true,
          homepageCategoryKeys: true,
          isVisibleOnClient: true,
          status: true,
          businessType: { select: { code: true } },
          updatedAt: true,
          promotionTags: {
            select: { promotionTag: { select: { code: true } } },
          },
        },
        orderBy: { id: "asc" },
      }),
    ]);
    const stored = settings
      .filter((s) => s.key.startsWith("explore.category."))
      .map((s) => s.value as unknown as ExploreCategory);
    const categories = [
      ...DEFAULT_EXPLORE_CATEGORIES.map(
        (c) => stored.find((s) => s.code === c.code) || c,
      ),
      ...stored.filter(
        (s) => !DEFAULT_EXPLORE_CATEGORIES.some((c) => c.code === s.code),
      ),
    ].filter((c) => !RETIRED_HOMEPAGE_CATEGORY_KEYS.includes(c.code));
    const topics = settings
      .filter((s) => s.key.startsWith("explore.topic."))
      .map((s) => s.value as unknown as ExploreTopic);
    const data: ContentDraft = {
      categories,
      topics,
      tags: tags.map((tag) => ({
        ...tag,
        id: String(tag.id),
        nameVi: tag.nameVi || undefined,
        nameEn: tag.nameEn || undefined,
        iconUrl: tag.iconUrl || undefined,
        iconText: tag.iconText || undefined,
        color: tag.color || undefined,
        description: tag.description || undefined,
        merchantReferenceCount: tag._count.merchants,
        reserved: RESERVED_PROMOTION_TAG_CODES.has(tag.code),
      })),
      recommendations: merchants.map((m) => ({
        merchantId: String(m.id),
        manualPopular:
          m.manualPopular ||
          parseHomepageCategoryKeys(m.homepageCategoryKeys).includes(
            "popular_food",
          ) ||
          m.promotionTags.some((t) => t.promotionTag.code === "HOT_FOOD"),
        homepageCategoryKeys: parseHomepageCategoryKeys(m.homepageCategoryKeys),
        baseManualPopular:
          m.manualPopular ||
          parseHomepageCategoryKeys(m.homepageCategoryKeys).includes(
            "popular_food",
          ) ||
          m.promotionTags.some((t) => t.promotionTag.code === "HOT_FOOD"),
        baseHomepageCategoryKeys: parseHomepageCategoryKeys(
          m.homepageCategoryKeys,
        ),
      })),
      version: 0,
      baseRevision: hash({
        settings,
        tags: tags.map(({ _count, ...tag }) => tag),
      }),
    };
    return {
      data,
      merchants: merchants.map((m) => ({ ...m, id: String(m.id) })),
    };
  }
  async get() {
    const [{ data, merchants }, saved] = await Promise.all([
      this.current(),
      this.prisma.platformSetting.findUnique({ where: { key: DRAFT_KEY } }),
    ]);
    const draft = saved ? (saved.value as unknown as ContentDraft) : data;
    const existing = new Set(
      draft.recommendations.map((rec) => rec.merchantId),
    );
    return {
      ...draft,
      recommendations: [
        ...draft.recommendations,
        ...data.recommendations.filter((rec) => !existing.has(rec.merchantId)),
      ],
      current: data,
      merchants,
      hasDraft: !!saved,
      conflicted: draft.baseRevision !== data.baseRevision,
    };
  }
  private validate(input: ContentDraft) {
    if (
      !input ||
      !Number.isInteger(input.version) ||
      input.version < 0 ||
      typeof input.baseRevision !== "string" ||
      !Array.isArray(input.categories) ||
      !Array.isArray(input.topics) ||
      !Array.isArray(input.tags) ||
      !Array.isArray(input.recommendations)
    )
      throw new BadRequestException("内容草稿格式不正确");
    const validate = (Type: new () => object, value: object) => {
      const v = plainToInstance(Type, value);
      if (
        validateSync(v, { whitelist: true, forbidNonWhitelisted: false }).length
      )
        throw new BadRequestException("内容字段不完整或格式不正确");
      return v;
    };
    for (const category of input.categories) {
      validate(ExploreCategoryDto, category);
      if (
        !category.nameZh.trim() ||
        RETIRED_HOMEPAGE_CATEGORY_KEYS.includes(category.code)
      )
        throw new BadRequestException("分类无效");
      if (
        category.legacyKeys.some(
          (k) =>
            !HOMEPAGE_CATEGORY_KEYS.includes(
              k as (typeof HOMEPAGE_CATEGORY_KEYS)[number],
            ),
        )
      )
        throw new BadRequestException("未知分类关联");
      if (
        category.code === "all" &&
        (!category.navigationOnly || category.iconKey !== "all")
      )
        throw new BadRequestException("全部服务须保留导航入口");
      if (category.navigationOnly && category.code !== "all")
        throw new BadRequestException("仅全部服务可作为导航入口");
      if (
        !category.navigationOnly &&
        !category.businessTypeCodes.length &&
        !category.legacyKeys.length
      )
        throw new BadRequestException("分类需要关联行业或分类");
    }
    for (const topic of input.topics) {
      validate(ExploreTopicDto, topic);
      assertMediaUrl(topic.imageUrl);
      if (!topic.nameZh.trim())
        throw new BadRequestException("专题名称不能为空");
      if (
        topic.enabled &&
        (!topic.imageUrl ||
          !validTopicTarget(
            topic,
            input.categories,
            input.tags
              .filter((t) => t.enabled && t.scope !== "CUISINE")
              .map((t) => t.code),
          ))
      )
        throw new BadRequestException("启用专题需要封面和有效目标");
    }
    for (const tag of input.tags) {
      validate(UpsertPromotionTagDto, tag);
      if (
        typeof tag.id !== "string" ||
        !tag.nameZh.trim() ||
        // Persisted legacy codes are immutable and checked against live data below.
        // Apply the new code format only when creating a new tag.
        (tag.id.startsWith("new-") &&
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(tag.code)) ||
        !/^\d+$|^new-[\w-]+$/.test(tag.id)
      )
        throw new BadRequestException("标签名称、编码或标识无效");
      assertMediaUrl(tag.iconUrl);
    }
    for (const rec of input.recommendations)
      if (
        !/^\d+$/.test(rec.merchantId) ||
        typeof rec.manualPopular !== "boolean" ||
        !Array.isArray(rec.homepageCategoryKeys) ||
        rec.homepageCategoryKeys.some(
          (k) =>
            !HOMEPAGE_CATEGORY_KEYS.includes(
              k as (typeof HOMEPAGE_CATEGORY_KEYS)[number],
            ),
        )
      )
        throw new BadRequestException("推荐商家格式不正确");
    for (const ids of [
      input.categories.map((c) => c.code),
      input.topics.map((t) => t.code),
      input.tags.map((t) => t.code),
      input.tags.map((t) => t.id),
      input.recommendations.map((r) => r.merchantId),
    ])
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException("存在重复编码或商家");
  }
  async save(
    input: ContentDraft & { previewToken?: string },
    actor: string,
    publish = false,
  ) {
    this.validate(input);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { data: live } = await this.current(tx);
          const saved = await tx.platformSetting.findUnique({
            where: { key: DRAFT_KEY },
          });
          const old = saved?.value as unknown as ContentDraft | undefined;
          if (
            (old?.version || 0) !== input.version ||
            input.baseRevision !== live.baseRevision
          )
            throw new ConflictException("内容已被其他操作更新，请重新加载核对");
          const draft = {
            categories: input.categories,
            topics: input.topics,
            tags: input.tags,
            recommendations: input.recommendations,
            baseRevision: input.baseRevision,
            version: input.version + 1,
            savedAt: new Date().toISOString(),
            savedBy: actor,
          };
          const types = await tx.merchantBusinessType.findMany({
            where: { enabled: true },
            select: { code: true },
          });
          if (
            input.categories.some((c) =>
              c.businessTypeCodes.some(
                (code) => !types.some((t) => t.code === code),
              ),
            )
          )
            throw new BadRequestException("关联行业不存在或已停用");
          for (const current of live.tags) {
            const edited = input.tags.find((t) => t.id === current.id);
            if (
              !edited ||
              edited.code !== current.code ||
              edited.scope !== current.scope
            )
              throw new BadRequestException(
                "已使用标签的编码、用途和关联必须保留，可将标签停用",
              );
            if (
              current.reserved &&
              (edited.enabled !== current.enabled ||
                edited.sortOrder !== current.sortOrder)
            )
              throw new BadRequestException("系统标签只允许修改文案");
          }
          if (publish) {
            const proof = input.previewToken
              ? await tx.platformSetting.findUnique({
                  where: {
                    key: `platform.content-preview.${input.previewToken}`,
                  },
                })
              : null;
            const value = proof?.value as
              | { actor: string; hash: string; expiresAt: number }
              | undefined;
            if (
              !value ||
              value.actor !== actor ||
              value.expiresAt < Date.now() ||
              value.hash !==
                hash({
                  categories: input.categories,
                  topics: input.topics,
                  tags: input.tags,
                  recommendations: input.recommendations,
                  version: input.version,
                  baseRevision: input.baseRevision,
                })
            )
              throw new ConflictException(
                "请先预览当前草稿，预览有效期为 15 分钟",
              );
          }
          const recKey = (rec: {
            manualPopular: boolean;
            homepageCategoryKeys: string[];
          }) =>
            JSON.stringify([
              rec.manualPopular,
              [
                ...new Set(
                  rec.homepageCategoryKeys.filter(
                    (key) => key !== "popular_food",
                  ),
                ),
              ].sort(),
            ]);
          const changedRecommendations = input.recommendations.filter((rec) => {
            const current = live.recommendations.find(
              (item) => item.merchantId === rec.merchantId,
            );
            if (
              rec.baseManualPopular === undefined ||
              !Array.isArray(rec.baseHomepageCategoryKeys)
            ) {
              if (current && recKey(rec) === recKey(current)) return false;
              throw new ConflictException("推荐资料版本不完整，请重新加载核对");
            }
            const base = {
              manualPopular: rec.baseManualPopular,
              homepageCategoryKeys: rec.baseHomepageCategoryKeys,
            };
            if (recKey(rec) === recKey(base)) return false;
            if (!current)
              throw new ConflictException("推荐商家已删除，请重新核对");
            if (
              recKey(current) !== recKey(base) &&
              recKey(current) !== recKey(rec)
            )
              throw new ConflictException(
                "商家的推荐设置已被其他操作修改，请重新核对",
              );
            return recKey(current) !== recKey(rec);
          });
          if (!publish) {
            await tx.platformSetting.upsert({
              where: { key: DRAFT_KEY },
              create: { key: DRAFT_KEY, value: json(draft) },
              update: { value: json(draft) },
            });
            return { ...draft, published: false };
          }
          await tx.platformSetting.deleteMany({
            where: {
              OR: [
                { key: { startsWith: "explore.category." } },
                { key: { startsWith: "explore.topic." } },
              ],
            },
          });
          for (const category of draft.categories)
            await tx.platformSetting.create({
              data: {
                key: `explore.category.${category.code}`,
                value: json(category),
              },
            });
          for (const topic of draft.topics)
            await tx.platformSetting.create({
              data: { key: `explore.topic.${topic.code}`, value: json(topic) },
            });
          for (const tag of draft.tags) {
            const values = {
              code: tag.code,
              nameZh: tag.nameZh.trim(),
              nameVi: tag.nameVi || null,
              nameEn: tag.nameEn || null,
              iconUrl: tag.iconUrl || null,
              iconText: tag.iconText || null,
              color: tag.color || null,
              description: tag.description || null,
              scope: tag.scope || ("OPERATIONAL" as const),
              sortOrder: tag.sortOrder || 0,
              enabled: tag.enabled !== false,
            };
            if (tag.id.startsWith("new-"))
              await tx.promotionTag.create({ data: values });
            else
              await tx.promotionTag.update({
                where: { id: BigInt(tag.id) },
                data: values,
              });
          }
          const hot = await tx.promotionTag.findUnique({
            where: { code: "HOT_FOOD" },
          });
          for (const rec of changedRecommendations) {
            const keys = [
              ...new Set(
                rec.homepageCategoryKeys.filter((k) => k !== "popular_food"),
              ),
            ];
            if (rec.manualPopular) keys.push("popular_food");
            await tx.merchant.update({
              where: { id: BigInt(rec.merchantId) },
              data: {
                manualPopular: rec.manualPopular,
                homepageCategoryKeys: JSON.stringify(keys),
              },
            });
            if (hot) {
              if (rec.manualPopular)
                await tx.merchantPromotionTag.upsert({
                  where: {
                    merchantId_promotionTagId: {
                      merchantId: BigInt(rec.merchantId),
                      promotionTagId: hot.id,
                    },
                  },
                  create: {
                    merchantId: BigInt(rec.merchantId),
                    promotionTagId: hot.id,
                  },
                  update: {},
                });
              else
                await tx.merchantPromotionTag.deleteMany({
                  where: {
                    merchantId: BigInt(rec.merchantId),
                    promotionTagId: hot.id,
                  },
                });
            }
          }
          await tx.platformSetting.deleteMany({ where: { key: DRAFT_KEY } });
          await tx.platformSetting.upsert({
            where: { key: "platform.content.published" },
            create: {
              key: "platform.content.published",
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
          return { published: true, at: draft.savedAt };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code)
      )
        throw new ConflictException("内容已更新或编码重复，请重新核对");
      throw error;
    }
  }
  async preview(input: ContentDraft, city: string, at: string, actor: string) {
    this.validate(input);
    if (typeof city !== "string" || !city.trim() || city.length > 80)
      throw new BadRequestException("请选择预览城市");
    const when = at ? new Date(at) : new Date();
    if (!Number.isFinite(when.getTime()))
      throw new BadRequestException("预览时间无效");
    const { data: live } = await this.current();
    const tagChanges = input.tags.flatMap((tag) => {
      const current = live.tags.find((item) => item.id === tag.id);
      const changed =
        !current ||
        ["nameZh", "nameVi", "nameEn", "enabled", "color", "description"].some(
          (field) =>
            (tag as unknown as Record<string, unknown>)[field] !==
            (current as unknown as Record<string, unknown>)[field],
        );
      return changed
        ? [
            {
              id: tag.id,
              before: current?.nameZh || null,
              after: tag.nameZh,
              affectedMerchantCount: current?.merchantReferenceCount || 0,
              enabled: tag.enabled !== false,
            },
          ]
        : [];
    });
    const rows = await this.prisma.merchant.findMany({
      where: { status: "ACTIVE", isVisibleOnClient: true, OR: [{ province: city }, { province: "" }] },
      include: {
        businessType: true,
        images: {
          where: { isVisible: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        signatureDishes: {
          where: { isVisible: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          take: 4,
        },
        promotionTags: { include: { promotionTag: true } },
      },
    });
    const ratings = await this.prisma.merchantReview.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: rows.map((m) => m.id) }, status: "PUBLISHED" },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const recommendations = buildHomeRecommendations(
      rows.map((row) => {
        const rec = input.recommendations.find(
          (r) => r.merchantId === String(row.id),
        );
        const rating = ratings.find((r) => r.merchantId === row.id);
        return {
          merchant: {
            ...row,
            id: String(row.id),
            nameZh: row.nameZh,
            homepageCategoryKeys:
              rec?.homepageCategoryKeys ||
              parseHomepageCategoryKeys(row.homepageCategoryKeys),
            manualPopular: rec?.manualPopular ?? row.manualPopular,
            promotionTags: row.promotionTags
              .filter((t) =>
                input.tags.some(
                  (tag) => tag.id === String(t.promotionTagId) && tag.enabled,
                ),
              )
              .map((t) => ({ code: t.promotionTag.code })),
            contentTemplate: merchantContentTemplate(
              row.businessType?.code,
              row.merchantType,
            ),
            distanceKm: null,
            isOpen: isMerchantOpen(row, when),
          },
          rating: rating
            ? {
                averageRating: rating._avg.rating || 0,
                total: rating._count._all,
              }
            : null,
        };
      }),
      city,
      false,
      when,
    );
    await this.prisma.platformSetting.deleteMany({
      where: {
        key: { startsWith: "platform.content-preview." },
        createdAt: { lt: new Date(Date.now() - 900000) },
      },
    });
    const previewToken = randomUUID();
    await this.prisma.platformSetting.create({
      data: {
        key: `platform.content-preview.${previewToken}`,
        value: json({
          actor,
          hash: hash({
            categories: input.categories,
            topics: input.topics,
            tags: input.tags,
            recommendations: input.recommendations,
            version: input.version,
            baseRevision: input.baseRevision,
          }),
          expiresAt: Date.now() + 900000,
        }),
      },
    });
    return {
      previewToken,
      tagChanges,
      city,
      at: when.toISOString(),
      categories: input.categories.filter((c) => c.enabled),
      topics: input.topics.filter(
        (t) => t.enabled && (!t.regions.length || t.regions.includes(city)),
      ),
      recommendations,
      notice:
        "仅预览指定城市与时间，不修改线上配置或服务器时间；使用城市排序，不含用户 GPS。",
    };
  }
}
