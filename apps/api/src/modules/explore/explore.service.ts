import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantServiceItem, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { HOMEPAGE_CATEGORY_KEYS, RETIRED_HOMEPAGE_CATEGORY_KEYS } from '../shared/homepage-category-keys';
import { DEFAULT_DISPLAY_CAPABILITIES } from '../platform/platform-dictionary-seed';
import { DEFAULT_EXPLORE_CATEGORIES, EXPLORE_BUSINESS_TYPES, ExploreCategory, ExploreTopic, merchantContentTemplate } from './explore-content';
import { ExploreCategoryDto, ExploreTopicDto, ServiceItemDto } from './explore.dto';

const CATEGORY_PREFIX = 'explore.category.';
const TOPIC_PREFIX = 'explore.topic.';

@Injectable()
export class ExploreService {
  constructor(private readonly prisma: PrismaService) {}

  async categories(includeDisabled = false): Promise<ExploreCategory[]> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { startsWith: CATEGORY_PREFIX } } });
    const stored = rows.map((row) => row.value as unknown as ExploreCategory)
      .filter((item) => !RETIRED_HOMEPAGE_CATEGORY_KEYS.includes(item.code));
    const overrides = new Map(stored.map((item) => [item.code, item]));
    const items = DEFAULT_EXPLORE_CATEGORIES.map((item) => overrides.get(item.code) ?? item);
    items.push(...stored.filter((item) => !DEFAULT_EXPLORE_CATEGORIES.some((defaultItem) => defaultItem.code === item.code)));
    return items.filter((item) => includeDisabled || item.enabled).sort(contentOrder);
  }

  async topics(includeDisabled = false): Promise<ExploreTopic[]> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { startsWith: TOPIC_PREFIX } } });
    const items = rows.map((row) => row.value as unknown as ExploreTopic).sort(contentOrder);
    if (includeDisabled) return items;
    const [categories, tags] = await Promise.all([
      this.categories(), this.prisma.promotionTag.findMany({ where: { enabled: true, scope: { in: ['OPERATIONAL', 'SCENE'] } }, select: { code: true } }),
    ]);
    return items.filter((item) => item.enabled && Boolean(item.imageUrl) && validTopicTarget(item, categories, tags.map((tag) => tag.code)));
  }

  async publicContent() {
    const [categories, topics] = await Promise.all([this.categories(), this.topics()]);
    return { categories, topics };
  }

  async saveCategory(dto: ExploreCategoryDto) {
    assertName(dto.nameZh);
    if (RETIRED_HOMEPAGE_CATEGORY_KEYS.includes(dto.code)) throw new BadRequestException('该分类已移除');
    if (dto.code === 'all' && (!dto.navigationOnly || dto.iconKey !== 'all')) {
      throw new BadRequestException('全部服务必须保留为导航入口');
    }
    if (dto.navigationOnly && dto.code !== 'all') throw new BadRequestException('仅全部服务可作为导航入口');
    if (!dto.navigationOnly && !dto.businessTypeCodes.length && !dto.legacyKeys.length) throw new BadRequestException('请选择分类关联');
    if (dto.legacyKeys.some((key) => !HOMEPAGE_CATEGORY_KEYS.includes(key as typeof HOMEPAGE_CATEGORY_KEYS[number]))) throw new BadRequestException('未知商家分类');
    const types = await this.prisma.merchantBusinessType.findMany({ where: { code: { in: dto.businessTypeCodes }, enabled: true }, select: { code: true } });
    if (dto.businessTypeCodes.some((code) => !types.some((type) => type.code === code))) throw new BadRequestException('关联行业不存在或已停用，请先在商家类型配置维护');
    return this.saveSetting(CATEGORY_PREFIX + dto.code, { ...dto, nameZh: dto.nameZh.trim() });
  }

  async saveTopic(dto: ExploreTopicDto) {
    assertName(dto.nameZh);
    assertMediaUrl(dto.imageUrl);
    const [categories, tags] = await Promise.all([
      this.categories(), this.prisma.promotionTag.findMany({ where: { enabled: true, scope: { in: ['OPERATIONAL', 'SCENE'] } }, select: { code: true } }),
    ]);
    if ((dto.categoryCode || dto.promotionTagCode) && !validTopicTarget(dto, categories, tags.map((tag) => tag.code))) throw new BadRequestException('专题目标不存在或已停用');
    if (dto.enabled && (!dto.imageUrl || !validTopicTarget(dto, categories, tags.map((tag) => tag.code)))) throw new BadRequestException('启用专题需要图片及有效内部目标');
    return this.saveSetting(TOPIC_PREFIX + dto.code, { ...dto, nameZh: dto.nameZh.trim() });
  }

  async deleteTopic(code: string) {
    // Remove the content reference only; uploaded assets can be shared elsewhere.
    await this.prisma.platformSetting.deleteMany({ where: { key: TOPIC_PREFIX + code } });
    return { deleted: true };
  }

  async resolveFilter(categoryCode?: string, topicCode?: string, region?: string, globalSearch = false) {
    const categories = await this.categories();
    const category = categoryCode ? categories.find((item) => item.code === categoryCode && !item.navigationOnly) : undefined;
    if (categoryCode && !category) throw new NotFoundException('分类不存在或已隐藏');
    const topic = topicCode ? (await this.topics()).find((item) => item.code === topicCode) : undefined;
    if (topicCode && !topic) throw new NotFoundException('专题不存在或已停用');
    if (topic && !globalSearch && topic.regions.length && !topic.regions.includes(region ?? '')) throw new BadRequestException('专题不适用于当前城市');
    const topicCategory = topic?.categoryCode ? categories.find((item) => item.code === topic.categoryCode) : undefined;
    return { category, topicCategory, promotionTagCode: topic?.promotionTagCode };
  }

  async seedDefaults() {
    const beforeTypes = await this.prisma.merchantBusinessType.count({ where: { code: { in: EXPLORE_BUSINESS_TYPES.map((item) => item.code) } } });
    await this.prisma.merchantBusinessType.createMany({
      data: EXPLORE_BUSINESS_TYPES.map((item, index) => ({ ...item, sortOrder: 100 + index * 10, showOnHome: false, defaultMerchantMode: 'DISPLAY', defaultCapabilities: DEFAULT_DISPLAY_CAPABILITIES as Prisma.InputJsonValue })),
      skipDuplicates: true,
    });
    const data = [
      ...DEFAULT_EXPLORE_CATEGORIES.map((item) => ({ key: CATEGORY_PREFIX + item.code, value: item as unknown as Prisma.InputJsonValue })),
      ...[
        { code: 'after-work', nameZh: '下班放松一下', subtitleZh: '给自己一点放松时光' },
        { code: 'meet-friends', nameZh: '今晚约朋友', subtitleZh: '美食相聚，快乐加倍' },
      ].map((item, index) => ({ key: TOPIC_PREFIX + item.code, value: { ...item, enabled: false, sortOrder: index * 10, regions: [] } as Prisma.InputJsonValue })),
    ];
    const inserted = await this.prisma.platformSetting.createMany({ data, skipDuplicates: true });
    return { businessTypesCreated: EXPLORE_BUSINESS_TYPES.length - beforeTypes, businessTypesReused: beforeTypes, settingsCreated: inserted.count, settingsReused: data.length - inserted.count };
  }

  async listServices(merchantId: bigint, publicOnly = false) {
    await this.requireServiceMerchant(merchantId, publicOnly);
    const items = await this.prisma.merchantServiceItem.findMany({ where: { merchantId, ...(publicOnly ? { isVisible: true } : {}) }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return { items: items.map(serializeServiceItem) };
  }

  async saveService(merchantId: bigint, dto: ServiceItemDto, itemId?: bigint) {
    await this.requireServiceMerchant(merchantId);
    assertName(dto.nameZh);
    assertMediaUrl(dto.imageUrl);
    if (dto.priceMode === 'INQUIRY' && dto.amountVnd != null && dto.amountVnd !== '') throw new BadRequestException('询价项目不能填写金额');
    if (dto.priceMode !== 'INQUIRY' && !/^\d{1,12}$/.test(dto.amountVnd ?? '')) throw new BadRequestException('固定价或起价需要明确金额');
    if (itemId) await this.requireOwnedItem(merchantId, itemId);
    const data = {
      merchantId, nameZh: dto.nameZh.trim(), nameVi: trimNull(dto.nameVi), nameEn: trimNull(dto.nameEn),
      descriptionZh: trimNull(dto.descriptionZh), descriptionVi: trimNull(dto.descriptionVi), descriptionEn: trimNull(dto.descriptionEn),
      imageUrl: trimNull(dto.imageUrl), durationMinutes: dto.durationMinutes ?? null, priceMode: dto.priceMode,
      amountVnd: dto.priceMode === 'INQUIRY' ? null : BigInt(dto.amountVnd!), unit: trimNull(dto.unit), sortOrder: dto.sortOrder, isVisible: dto.isVisible,
    };
    const item = itemId
      ? await this.prisma.merchantServiceItem.update({ where: { id: itemId }, data })
      : await this.prisma.merchantServiceItem.create({ data });
    return serializeServiceItem(item);
  }

  async deleteService(merchantId: bigint, itemId: bigint) {
    await this.requireServiceMerchant(merchantId);
    await this.requireOwnedItem(merchantId, itemId);
    await this.prisma.merchantServiceItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  private async requireServiceMerchant(id: bigint, publicOnly = false) {
    const merchant = await this.prisma.merchant.findFirst({ where: { id, status: publicOnly ? 'ACTIVE' : { not: 'DELETED' }, ...(publicOnly ? { isVisibleOnClient: true } : {}) }, include: { businessType: true } });
    if (!merchant) throw new NotFoundException('商家不存在或不可见');
    if (merchantContentTemplate(merchant.businessType?.code, merchant.merchantType) === 'RESTAURANT') throw new BadRequestException('餐饮内容请在原菜单或招牌菜入口维护');
    return merchant;
  }

  private async requireOwnedItem(merchantId: bigint, id: bigint) {
    const item = await this.prisma.merchantServiceItem.findFirst({ where: { merchantId, id } });
    if (!item) throw new NotFoundException('服务项目不存在');
    return item;
  }

  private async saveSetting(key: string, value: object) {
    await this.prisma.platformSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
    return value;
  }
}

function contentOrder(a: { sortOrder: number; code: string }, b: { sortOrder: number; code: string }) { return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code); }
function trimNull(value?: string | null) { return value?.trim() || null; }
function assertName(name: string) { if (!name.trim()) throw new BadRequestException('名称不能为空'); }
export function assertMediaUrl(url?: string | null) {
  if (url && !/^\/uploads\/[\w/.-]+$/.test(url) && !/^https:\/\/[^\s]+$/.test(url)) throw new BadRequestException('图片必须来自安全上传或 HTTPS 地址');
}
export function validTopicTarget(topic: Pick<ExploreTopic, 'categoryCode' | 'promotionTagCode'>, categories: ExploreCategory[], tags: string[]) {
  return Boolean(topic.categoryCode || topic.promotionTagCode)
    && (!topic.categoryCode || categories.some((item) => item.code === topic.categoryCode && item.enabled && !item.navigationOnly))
    && (!topic.promotionTagCode || tags.includes(topic.promotionTagCode));
}
export function serializeServiceItem(item: MerchantServiceItem) {
  return { id: item.id.toString(), nameZh: item.nameZh, nameVi: item.nameVi, nameEn: item.nameEn, descriptionZh: item.descriptionZh, descriptionVi: item.descriptionVi, descriptionEn: item.descriptionEn, imageUrl: item.imageUrl, durationMinutes: item.durationMinutes, priceMode: item.priceMode, amountVnd: item.amountVnd?.toString() ?? null, unit: item.unit, sortOrder: item.sortOrder, isVisible: item.isVisible };
}
