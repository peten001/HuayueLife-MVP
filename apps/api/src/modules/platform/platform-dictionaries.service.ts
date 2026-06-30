import { Injectable, NotFoundException } from '@nestjs/common';
import { MerchantMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  DEFAULT_BUSINESS_TYPES,
  DEFAULT_CAPABILITIES,
  DEFAULT_PROMOTION_TAGS,
} from './platform-dictionary-seed';
import {
  UpsertBusinessTypeDto,
  UpsertPromotionTagDto,
} from './dto/platform-dictionary.dto';

@Injectable()
export class PlatformDictionariesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults() {
    const [businessTypeCount, promotionTagCount, capabilityCount] = await Promise.all([
      this.prisma.merchantBusinessType.count(),
      this.prisma.promotionTag.count(),
      this.prisma.capability.count(),
    ]);

    if (businessTypeCount === 0) {
      await this.prisma.merchantBusinessType.createMany({
        data: DEFAULT_BUSINESS_TYPES.map((item) => ({
          ...item,
          defaultCapabilities: item.defaultCapabilities as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    if (promotionTagCount === 0) {
      await this.prisma.promotionTag.createMany({
        data: DEFAULT_PROMOTION_TAGS,
        skipDuplicates: true,
      });
    }
    if (capabilityCount === 0) {
      await this.prisma.capability.createMany({
        data: DEFAULT_CAPABILITIES,
        skipDuplicates: true,
      });
    }
    await this.prisma.merchantBusinessType.updateMany({
      where: { code: 'FOOD_SERVICE' },
      data: { showOnHome: false },
    });
  }

  async listBusinessTypes() {
    await this.ensureDefaults();
    const items = await this.prisma.merchantBusinessType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: items.map(serializeBusinessType) };
  }

  async createBusinessType(dto: UpsertBusinessTypeDto) {
    await this.ensureDefaults();
    const item = await this.prisma.merchantBusinessType.create({
      data: await this.businessTypeData(dto),
    });
    return serializeBusinessType(item);
  }

  async updateBusinessType(id: bigint, dto: Partial<UpsertBusinessTypeDto>) {
    await this.ensureBusinessType(id);
    const item = await this.prisma.merchantBusinessType.update({
      where: { id },
      data: await this.businessTypeData(dto),
    });
    return serializeBusinessType(item);
  }

  async disableBusinessType(id: bigint) {
    await this.ensureBusinessType(id);
    const item = await this.prisma.merchantBusinessType.update({
      where: { id },
      data: { enabled: false },
    });
    return serializeBusinessType(item);
  }

  async listPromotionTags() {
    await this.ensureDefaults();
    const items = await this.prisma.promotionTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: items.map(serializePromotionTag) };
  }

  async createPromotionTag(dto: UpsertPromotionTagDto) {
    await this.ensureDefaults();
    const item = await this.prisma.promotionTag.create({
      data: promotionTagData(dto),
    });
    return serializePromotionTag(item);
  }

  async updatePromotionTag(id: bigint, dto: Partial<UpsertPromotionTagDto>) {
    await this.ensurePromotionTag(id);
    const item = await this.prisma.promotionTag.update({
      where: { id },
      data: promotionTagData(dto),
    });
    return serializePromotionTag(item);
  }

  async disablePromotionTag(id: bigint) {
    await this.ensurePromotionTag(id);
    const item = await this.prisma.promotionTag.update({
      where: { id },
      data: { enabled: false },
    });
    return serializePromotionTag(item);
  }

  async listCapabilities() {
    await this.ensureDefaults();
    const items = await this.prisma.capability.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: items.map(serializeCapability) };
  }

  private async ensureBusinessType(id: bigint) {
    const item = await this.prisma.merchantBusinessType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Business type not found');
    return item;
  }

  private async ensurePromotionTag(id: bigint) {
    const item = await this.prisma.promotionTag.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Promotion tag not found');
    return item;
  }

  private async businessTypeData(dto: Partial<UpsertBusinessTypeDto>): Promise<Prisma.MerchantBusinessTypeUncheckedCreateInput> {
    let parentId: bigint | null | undefined;
    let level = dto.level;
    let path = trimOrNull(dto.path);
    if (dto.parentId !== undefined) {
      parentId = dto.parentId ? BigInt(dto.parentId) : null;
      if (parentId) {
        const parent = await this.prisma.merchantBusinessType.findUnique({
          where: { id: parentId },
          select: { code: true, level: true, path: true },
        });
        if (!parent) throw new NotFoundException('Parent business type not found');
        level = (parent.level ?? 1) + 1;
        path = `${parent.path ?? parent.code}/${dto.code?.trim() ?? ''}`;
      } else {
        level = 1;
        path = dto.code?.trim();
      }
    }
    return stripUndefined({
      parentId,
      code: dto.code?.trim(),
      nameZh: dto.nameZh?.trim(),
      nameVi: trimOrNull(dto.nameVi),
      nameEn: trimOrNull(dto.nameEn),
      iconUrl: trimOrNull(dto.iconUrl),
      level,
      path,
      sortOrder: dto.sortOrder,
      showOnHome: dto.showOnHome,
      enabled: dto.enabled,
      defaultMerchantMode: dto.defaultMerchantMode as MerchantMode | undefined,
      defaultCapabilities:
        dto.defaultCapabilities === undefined
          ? undefined
          : (dto.defaultCapabilities as Prisma.InputJsonValue),
    }) as Prisma.MerchantBusinessTypeUncheckedCreateInput;
  }
}

function promotionTagData(dto: Partial<UpsertPromotionTagDto>): Prisma.PromotionTagUncheckedCreateInput {
  return stripUndefined({
    code: dto.code?.trim(),
    nameZh: dto.nameZh?.trim(),
    nameVi: trimOrNull(dto.nameVi),
    nameEn: trimOrNull(dto.nameEn),
    iconUrl: trimOrNull(dto.iconUrl),
    iconText: trimOrNull(dto.iconText),
    color: trimOrNull(dto.color),
    description: trimOrNull(dto.description),
    sortOrder: dto.sortOrder,
    enabled: dto.enabled,
  }) as Prisma.PromotionTagUncheckedCreateInput;
}

function serializeBusinessType(item: {
  id: bigint;
  parentId: bigint | null;
  code: string;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  iconUrl: string | null;
  level: number;
  path: string | null;
  sortOrder: number;
  showOnHome: boolean;
  enabled: boolean;
  defaultMerchantMode: MerchantMode;
  defaultCapabilities: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...item,
    id: item.id.toString(),
    parentId: item.parentId?.toString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializePromotionTag(item: {
  id: bigint;
  code: string;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  iconUrl: string | null;
  iconText: string | null;
  color: string | null;
  description: string | null;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...item,
    id: item.id.toString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeCapability(item: {
  id: bigint;
  code: string;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  groupCode: string;
  groupNameZh: string;
  groupNameVi: string | null;
  groupNameEn: string | null;
  enabled: boolean;
  defaultValue: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...item,
    id: item.id.toString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function trimOrNull(value: string | undefined) {
  const next = value?.trim();
  return next ? next : undefined;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
