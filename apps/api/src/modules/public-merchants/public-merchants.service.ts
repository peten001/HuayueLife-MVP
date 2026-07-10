import {
  BadRequestException,
  Injectable,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Category, Merchant, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { MerchantCapabilitiesService } from '../merchant-capabilities/merchant-capabilities.service';
import { AppConfigService } from '../app-config/app-config.service';
import { isOrderingCapabilityCode } from '../app-config/ordering-capabilities';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';
import {
  parseHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

const PAGE_SIZE = 20;
/**
 * NOTE:
 * Bac Giang / Bac Ninh are BUSINESS REGIONS, not administrative provinces.
 * This system does NOT use real-world administrative boundaries.
 * GPS is only used to map user location into operational regions.
 *
 * The database column is still named `province` for backward compatibility,
 * but discovery logic must treat it as the single operational-region filter.
 */
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
const OPERATIONAL_REGION_ALIASES: Record<'北江' | '北宁', string[]> = {
  北江: ['北江', 'Bac Giang', 'Bắc Giang', 'BAC_GIANG', 'bac giang', 'bắc giang'],
  北宁: ['北宁', 'Bac Ninh', 'Bắc Ninh', 'BAC_NINH', 'bac ninh', 'bắc ninh'],
};

@Injectable()
export class PublicMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantCapabilities: MerchantCapabilitiesService,
    private readonly appConfig: AppConfigService,
  ) {}

  async nearby(query: NearbyMerchantsQueryDto) {
    console.log('[public-merchants] nearby query', query);
    const selectedOperationalRegion = resolveSelectedOperationalRegion(query);
    console.log('[public-merchants] selected operational region', selectedOperationalRegion);

    if (!selectedOperationalRegion) {
      return {
        items: [],
        page: query.page,
        pageSize: PAGE_SIZE,
        total: 0,
        locationMode: 'REGION_REQUIRED',
      };
    }

    const where: Prisma.MerchantWhereInput = {
      status: 'ACTIVE',
      isVisibleOnClient: true,
    };
    where.province = selectedOperationalRegion;
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
    const hasUserLocation =
      Number.isFinite(query.lat)
      && Number.isFinite(query.lng);
    const results = merchants
      .map((merchant) =>
        this.serializeMerchant(
          merchant,
          merchant.categories ?? [],
          hasUserLocation
            ? resolveMerchantDistance(
                query.lat as number,
                query.lng as number,
                merchant.latitude,
                merchant.longitude,
              )
            : null,
        ),
      )
      .sort((a, b) => {
        const distanceCompare = compareNullableDistance(a.distanceKm, b.distanceKm);
        if (distanceCompare !== 0) return distanceCompare;
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
      locationMode: hasUserLocation ? 'GPS' : 'CITY',
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
    this.appConfig.assertOrderingEnabled();
    const merchant = tableToken
      ? await this.requireDineInMerchant(id, tableToken)
      : await this.requirePublicMerchant(id);
    if (!this.canShowMenu(merchant)) {
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
    this.appConfig.assertOrderingEnabled();
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

  private serializeMerchant(
    merchant: PublicMerchantRow,
    categories: Array<Pick<Category, 'nameZh' | 'nameVi'>>,
    distance: number | null,
  ) {
    const resolvedCapabilities =
      this.merchantCapabilities.resolveCapabilitiesFromMerchant(merchant);
    const qrOrderEnabled = this.merchantCapabilities.resolveCapabilityFlag(
      merchant,
      'qrOrderEnabled',
      false,
    );
    const platformOrderingEnabled = this.appConfig.isPlatformOrderingEnabled();
    const pickupEnabled = platformOrderingEnabled
      ? resolvedCapabilities.pickupEnabled
      : false;
    const deliveryEnabled = platformOrderingEnabled
      ? resolvedCapabilities.deliveryEnabled
      : false;
    const dineInEnabled = platformOrderingEnabled
      ? Boolean(merchant.dineInEnabled)
      : false;
    const effectiveQrOrderEnabled = platformOrderingEnabled ? qrOrderEnabled : false;

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
      supportedOrderTypes: platformOrderingEnabled
        ? supportedOrderTypes(merchant, resolvedCapabilities)
        : [],
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd.toString(),
      deliveryFeeVnd: merchant.deliveryFeeVnd.toString(),
      latitude: merchant.latitude.toString(),
      longitude: merchant.longitude.toString(),
      deliveryRadiusKm: merchant.deliveryRadiusKm.toString(),
      dineInEnabled,
      pickupEnabled,
      deliveryEnabled,
      qrOrderEnabled: effectiveQrOrderEnabled,
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
        isEnabled: platformOrderingEnabled || !isOrderingCapabilityCode(item.capability.code)
          ? item.isEnabled
          : false,
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

  private canShowMenu(merchant: PublicMerchantRow) {
    if (!this.appConfig.isPlatformOrderingEnabled()) return false;
    const resolvedCapabilities =
      this.merchantCapabilities.resolveCapabilitiesFromMerchant(merchant);
    const qrOrderEnabled = this.merchantCapabilities.resolveCapabilityFlag(
      merchant,
      'qrOrderEnabled',
      false,
    );
    if ((merchant.capabilities ?? []).length) {
      return Boolean(
        resolvedCapabilities.pickupEnabled
        || resolvedCapabilities.deliveryEnabled
        || qrOrderEnabled,
      );
    }
    if (merchant.merchantMode === 'DISPLAY' || merchant.merchantMode === 'DISPLAY_ONLY') {
      return false;
    }
    return Boolean(
      merchant.dineInEnabled
      || resolvedCapabilities.pickupEnabled
      || resolvedCapabilities.deliveryEnabled,
    );
  }
}

function supportedOrderTypes(
  merchant: PublicMerchantRow,
  resolvedCapabilities: {
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
  },
) {
  if ((merchant.capabilities ?? []).length) {
    return [
      merchant.dineInEnabled ? 'DINE_IN' : null,
      resolvedCapabilities.pickupEnabled ? 'PICKUP' : null,
      resolvedCapabilities.deliveryEnabled ? 'DELIVERY' : null,
    ].filter(Boolean);
  }
  if (merchant.merchantMode === 'DISPLAY' || merchant.merchantMode === 'DISPLAY_ONLY') return [];
  return [
    merchant.dineInEnabled ? 'DINE_IN' : null,
    resolvedCapabilities.pickupEnabled ? 'PICKUP' : null,
    resolvedCapabilities.deliveryEnabled ? 'DELIVERY' : null,
  ].filter(Boolean);
}

function resolveSelectedOperationalRegion(
  query: NearbyMerchantsQueryDto,
): '北江' | '北宁' | null {
  const rawOperationalRegion = query.province ?? query.city;
  if (!rawOperationalRegion) return null;
  const normalized = normalizeOperationalRegionInput(rawOperationalRegion);
  if (!normalized) {
    throw new BadRequestException('Invalid operational region');
  }
  return normalized;
}

function normalizeOperationalRegionInput(value?: string) {
  const normalizedValue = normalizeOperationalRegionText(value);
  if (!normalizedValue) return null;
  for (const [operationalRegion, aliases] of Object.entries(OPERATIONAL_REGION_ALIASES) as Array<
    ['北江' | '北宁', string[]]
  >) {
    if (
      aliases.some((alias) => normalizeOperationalRegionText(alias) === normalizedValue)
    ) {
      return operationalRegion;
    }
  }
  return null;
}

function normalizeOperationalRegionText(value?: string) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function resolveMerchantDistance(
  userLatitude: number,
  userLongitude: number,
  merchantLatitude: Prisma.Decimal | number | null,
  merchantLongitude: Prisma.Decimal | number | null,
) {
  const latitude = Number(merchantLatitude);
  const longitude = Number(merchantLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return distanceKm(userLatitude, userLongitude, latitude, longitude);
}

function compareNullableDistance(left: number | null, right: number | null) {
  const leftValue = left ?? Number.POSITIVE_INFINITY;
  const rightValue = right ?? Number.POSITIVE_INFINITY;
  if (leftValue === rightValue) return 0;
  return leftValue - rightValue;
}
