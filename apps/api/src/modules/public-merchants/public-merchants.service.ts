import {
  BadRequestException,
  Injectable,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Category, Merchant, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isMerchantOpen } from '../../common/utils/merchant-hours';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';
import {
  parseHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

const PAGE_SIZE = 20;
type PublicMerchantRow = Merchant & {
  businessType?: {
    id: bigint;
    code: string;
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
  } | null;
  promotionTags?: Array<{
    promotionTag: {
      id: bigint;
      code: string;
      nameZh: string;
      nameVi: string | null;
      nameEn: string | null;
      iconText: string | null;
      color: string | null;
    };
  }>;
  capabilities?: Array<{
    isEnabled: boolean;
    capability: {
      id: bigint;
      code: string;
      nameZh: string;
      nameVi: string | null;
      nameEn: string | null;
    };
  }>;
  images?: Array<{
    id: bigint;
    imageType: string;
    imageUrl: string;
    titleZh: string | null;
    titleVi: string | null;
    titleEn: string | null;
    sortOrder: number;
    isVisible: boolean;
  }>;
  categories?: Array<Pick<Category, 'nameZh' | 'nameVi'>>;
};
const PROVINCE_ALIASES: Record<'北江' | '北宁', string[]> = {
  北江: ['北江', 'Bac Giang', 'Bắc Giang', 'BAC_GIANG', 'bac giang', 'bắc giang'],
  北宁: ['北宁', 'Bac Ninh', 'Bắc Ninh', 'BAC_NINH', 'bac ninh', 'bắc ninh'],
};

@Injectable()
export class PublicMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async nearby(query: NearbyMerchantsQueryDto) {
    console.log('[public-merchants] nearby query', query);
    const selectedProvince = resolveSelectedProvince(query);
    console.log('[public-merchants] selected province', selectedProvince);

    const where: Prisma.MerchantWhereInput = {
      status: 'ACTIVE',
      isVisibleOnClient: true,
    };
    if (selectedProvince) {
      where.province = selectedProvince;
    }
    if (query.businessTypeId) {
      where.businessTypeId = BigInt(query.businessTypeId);
    }
    if (query.promotionTag) {
      where.promotionTags = {
        some: { promotionTag: { code: query.promotionTag, enabled: true } },
      };
    }

    const include = {
      businessType: true,
      promotionTags: { where: { promotionTag: { enabled: true } }, include: { promotionTag: true } },
      capabilities: { include: { capability: true } },
      images: {
        where: { isVisible: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
      categories: {
        where: { isActive: true },
        select: {
          nameZh: true,
          nameVi: true,
        },
      },
    } satisfies Prisma.MerchantInclude;

    let merchants: PublicMerchantRow[];
    try {
      merchants = await this.prisma.merchant.findMany({
        where,
        include,
      });
    } catch (error) {
      console.error('[public-merchants] nearby error', error);
      merchants = [];
    }

    console.log('[public-merchants] raw merchants count', merchants.length);
    const results = merchants
      .map((merchant) => this.toMerchantSummary(merchant))
      .sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        return a.nameZh.localeCompare(b.nameZh, 'zh-CN');
      });
    console.log('[public-merchants] nearby result count', results.length);

    const start = (query.page - 1) * PAGE_SIZE;
    return {
      items: results.slice(start, start + PAGE_SIZE),
      page: query.page,
      pageSize: PAGE_SIZE,
      total: results.length,
      locationMode: 'CITY',
    };
  }

  async detail(id: bigint) {
    const merchant = await this.requirePublicMerchant(id);
    const categories = await this.prisma.category.findMany({
      where: {
        merchantId: id,
        isActive: true,
      },
      select: {
        nameZh: true,
        nameVi: true,
      },
    });
    return this.serializeMerchant(merchant, categories, null);
  }

  async menu(id: bigint, tableToken?: string) {
    const merchant = tableToken
      ? await this.requireDineInMerchant(id, tableToken)
      : await this.requirePublicMerchant(id);
    if (!canShowMenu(merchant)) {
      throw new GoneException('该商家暂未开通菜单/下单功能');
    }
    const categories = await this.prisma.category.findMany({
      where: {
        merchantId: id,
        isActive: true,
      },
      include: {
        products: {
          where: {
            productType: 'FOOD',
            status: { in: ['ON_SALE', 'SOLD_OUT'] },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return {
      merchant: {
        id: merchant.id,
        nameZh: merchant.nameZh,
        nameVi: merchant.nameVi,
        isOpen: isMerchantOpen(merchant),
      },
      categories,
    };
  }

  async product(id: bigint, tableToken?: string) {
    const merchantFilter: Prisma.MerchantWhereInput = tableToken
      ? await this.resolveDineInMerchantFilter(tableToken)
      : {
          status: 'ACTIVE',
          isVisibleOnClient: true,
        };
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        productType: 'FOOD',
        status: { in: ['ON_SALE', 'SOLD_OUT'] },
        category: { isActive: true },
        merchant: merchantFilter,
      },
      include: {
        category: true,
        merchant: {
          select: { id: true, nameZh: true, nameVi: true },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found or unavailable');
    }
    return product;
  }

  private async requirePublicMerchant(id: bigint) {
    // isVisibleOnClient only controls platform discovery and search exposure.
    // It must not block dine-in access when a valid table QR has already been resolved.
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        isVisibleOnClient: true,
      },
      include: {
        businessType: true,
        promotionTags: { where: { promotionTag: { enabled: true } }, include: { promotionTag: true } },
        capabilities: { include: { capability: true } },
        images: {
          where: { isVisible: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found or unavailable');
    }
    return merchant;
  }

  private async requireDineInMerchant(id: bigint, tableToken: string) {
    const table = await this.resolveDineInTable(tableToken);
    if (table.merchantId !== id) {
      throw new NotFoundException('Merchant not found or unavailable');
    }
    return table.merchant;
  }

  private async resolveDineInMerchantFilter(
    tableToken: string,
  ): Promise<Prisma.MerchantWhereInput> {
    const table = await this.resolveDineInTable(tableToken);
    return {
      id: table.merchantId,
      status: 'ACTIVE',
      merchantType: 'RESTAURANT',
    } satisfies Prisma.MerchantWhereInput;
  }

  private async resolveDineInTable(tableToken: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: tableToken },
      include: {
        merchant: {
          include: { capabilities: { include: { capability: true } } },
        },
      },
    });
    if (!table) {
      throw new NotFoundException('Merchant not found or unavailable');
    }
    if (table.status !== 'ACTIVE') {
      throw new GoneException('该桌台已停用');
    }
    if (table.merchant.status !== 'ACTIVE') {
      throw new GoneException('商家当前不可用');
    }
    if (!table.merchant.dineInEnabled) {
      throw new GoneException('商家当前未开启堂食');
    }
    return table;
  }

  private toMerchantSummary(merchant: PublicMerchantRow) {
    return this.serializeMerchant(merchant, merchant.categories ?? [], null);
  }

  private serializeMerchant(
    merchant: PublicMerchantRow,
    categories: Array<Pick<Category, 'nameZh' | 'nameVi'>>,
    distance: number | null,
  ) {
    const capabilityValues = new Map(
      (merchant.capabilities ?? []).map((item) => [item.capability.code, item.isEnabled]),
    );

    return {
      ...merchant,
      id: merchant.id,
      nameZh: merchant.nameZh,
      nameVi: merchant.nameVi,
      nameEn: merchant.nameEn,
      merchantMode: merchant.merchantMode,
      claimStatus: merchant.claimStatus,
      businessType: merchant.businessType
        ? {
            id: merchant.businessType.id.toString(),
            code: merchant.businessType.code,
            nameZh: merchant.businessType.nameZh,
            nameVi: merchant.businessType.nameVi,
            nameEn: merchant.businessType.nameEn,
          }
        : null,
      logoUrl: merchant.logoUrl,
      coverUrl: merchant.coverUrl,
      addressDetail: merchant.addressDetail,
      addressZh: merchant.addressZh,
      addressVi: merchant.addressVi,
      addressEn: merchant.addressEn,
      openingHoursText: merchant.openingHoursText,
      descriptionZh: merchant.descriptionZh,
      descriptionVi: merchant.descriptionVi,
      descriptionEn: merchant.descriptionEn,
      city: merchant.city,
      distanceKm: distance === null ? null : Number(distance.toFixed(2)),
      isOpen: isMerchantOpen(merchant),
      supportedOrderTypes: supportedOrderTypes(merchant),
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd.toString(),
      deliveryFeeVnd: merchant.deliveryFeeVnd.toString(),
      latitude: merchant.latitude.toString(),
      longitude: merchant.longitude.toString(),
      deliveryRadiusKm: merchant.deliveryRadiusKm.toString(),
      dineInEnabled: Boolean(merchant.dineInEnabled),
      pickupEnabled: capabilityValues.size
        ? Boolean(capabilityValues.get('pickupEnabled'))
        : Boolean(merchant.pickupEnabled),
      deliveryEnabled: capabilityValues.size
        ? Boolean(capabilityValues.get('deliveryEnabled'))
        : Boolean(merchant.deliveryEnabled),
      qrOrderEnabled: capabilityValues.size
        ? Boolean(capabilityValues.get('qrOrderEnabled'))
        : false,
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
      isNew: Boolean(merchant.isNew),
      promotionTags: (merchant.promotionTags ?? []).map((item) => ({
        id: item.promotionTag.id.toString(),
        code: item.promotionTag.code,
        nameZh: item.promotionTag.nameZh,
        nameVi: item.promotionTag.nameVi,
        nameEn: item.promotionTag.nameEn,
        iconText: item.promotionTag.iconText,
        color: item.promotionTag.color,
      })),
      capabilities: (merchant.capabilities ?? []).map((item) => ({
        id: item.capability.id.toString(),
        code: item.capability.code,
        nameZh: item.capability.nameZh,
        nameVi: item.capability.nameVi,
        nameEn: item.capability.nameEn,
        isEnabled: item.isEnabled,
      })),
      images: (merchant.images ?? []).map((item) => ({
        id: item.id.toString(),
        imageType: item.imageType,
        imageUrl: item.imageUrl,
        titleZh: item.titleZh,
        titleVi: item.titleVi,
        titleEn: item.titleEn,
        sortOrder: item.sortOrder,
      })),
      categoryNames: categories.flatMap((category) =>
        [category.nameZh, category.nameVi].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    };
  }
}

function supportedOrderTypes(merchant: PublicMerchantRow) {
  const capabilities = new Map(
    (merchant.capabilities ?? []).map((item) => [item.capability.code, item.isEnabled]),
  );
  if (capabilities.size) {
    return [
      merchant.dineInEnabled ? 'DINE_IN' : null,
      capabilities.get('pickupEnabled') ? 'PICKUP' : null,
      capabilities.get('deliveryEnabled') ? 'DELIVERY' : null,
    ].filter(Boolean);
  }
  if (merchant.merchantMode === 'DISPLAY' || merchant.merchantMode === 'DISPLAY_ONLY') return [];
  return [
    merchant.dineInEnabled ? 'DINE_IN' : null,
    merchant.pickupEnabled ? 'PICKUP' : null,
    merchant.deliveryEnabled ? 'DELIVERY' : null,
  ].filter(Boolean);
}

function canShowMenu(merchant: PublicMerchantRow) {
  const capabilities = new Map(
    (merchant.capabilities ?? []).map((item) => [item.capability.code, item.isEnabled]),
  );
  if (capabilities.size) {
    return Boolean(
      capabilities.get('pickupEnabled') ||
      capabilities.get('deliveryEnabled') ||
      capabilities.get('qrOrderEnabled'),
    );
  }
  if (merchant.merchantMode === 'DISPLAY' || merchant.merchantMode === 'DISPLAY_ONLY') {
    return false;
  }
  return Boolean(merchant.dineInEnabled || merchant.pickupEnabled || merchant.deliveryEnabled);
}

function resolveSelectedProvince(
  query: NearbyMerchantsQueryDto,
): '北江' | '北宁' | null {
  const rawValue = query.province ?? query.city;
  if (!rawValue) return null;
  const normalized = normalizeProvinceInput(rawValue);
  if (!normalized) {
    throw new BadRequestException('Invalid province');
  }
  return normalized;
}

function normalizeProvinceInput(value?: string) {
  const normalizedValue = normalizeProvinceText(value);
  if (!normalizedValue) return null;
  for (const [province, aliases] of Object.entries(PROVINCE_ALIASES) as Array<
    ['北江' | '北宁', string[]]
  >) {
    if (
      aliases.some((alias) => normalizeProvinceText(alias) === normalizedValue)
    ) {
      return province;
    }
  }
  return null;
}

function normalizeProvinceText(value?: string) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
