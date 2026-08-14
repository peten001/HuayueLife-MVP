import {
  BadRequestException,
  Injectable,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Category, Merchant, OrderType, Prisma, PromotionTagScope } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { MerchantCapabilitiesService } from '../merchant-capabilities/merchant-capabilities.service';
import { AppConfigService } from '../app-config/app-config.service';
import { isOrderingCapabilityCode } from '../app-config/ordering-capabilities';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';
import {
  parseHomepageCategoryKeys,
  type HomepageCategoryKey,
} from '../shared/homepage-category-keys';

const PAGE_SIZE = 20;
const SALES_ORDER_TYPES: OrderType[] = ['PICKUP', 'DELIVERY', 'DINE_IN'];
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
      scope: PromotionTagScope;
      sortOrder: number;
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
  signatureDishes?: Array<{
    id: bigint;
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
    imageUrl: string;
    sortOrder: number;
  }>;
  hotRecommendations?: Array<{
    id: bigint;
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
    imageUrl: string | null;
    priceVnd: bigint;
    salesCount: number;
    hotRank: number;
  }>;
  categories?: Array<Pick<Category, 'nameZh' | 'nameVi' | 'nameEn'>>;
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
          nameEn: true,
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
      throw error;
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
      .filter((merchant) => matchesHomepageCategory(
        merchant,
        query.homepageCategoryKey,
      ))
      .filter((merchant) => matchesMerchantKeyword(merchant, query.keyword))
      .filter((merchant) => matchesServiceFilters(
        merchant,
        query.serviceFilter ?? [],
      ))
      .sort((a, b) => {
        const featuredCompare = Number(isFeaturedMerchant(b)) - Number(isFeaturedMerchant(a));
        if (featuredCompare !== 0) return featuredCompare;
        const distanceCompare = compareNullableDistance(a.distanceKm, b.distanceKm);
        if (distanceCompare !== 0) return distanceCompare;
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        const nameCompare = a.nameZh.localeCompare(b.nameZh, 'zh-CN');
        if (nameCompare !== 0) return nameCompare;
        return compareMerchantIds(a.id, b.id);
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
    const [categories, hotRecommendations, signatureDishes] = await Promise.all([
      this.prisma.category.findMany({
        where: {
          merchantId: id,
          isActive: true,
        },
        select: {
          nameZh: true,
          nameVi: true,
          nameEn: true,
        },
      }),
      this.hotRecommendations(id),
      this.resolveSignatureDishes(merchant),
    ]);
    return this.serializeMerchant(
      merchant,
      categories,
      null,
      hotRecommendations,
      signatureDishes,
      true,
    );
  }

  async menu(id: bigint, tableToken?: string) {
    this.appConfig.assertOrderingEnabled();
    const merchant = tableToken
      ? await this.requireDineInMerchant(id, tableToken)
      : await this.requirePublicMerchant(id);
    if (!this.canShowMenu(merchant)) {
      throw new GoneException('该商家暂未开通菜单/下单功能');
    }
    const [categories, salesByProductId] = await Promise.all([
      this.prisma.category.findMany({
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
      }),
      this.salesByProductId(id),
    ]);
    const categoriesWithSales = categories.map(({ products, ...category }) => ({
      ...category,
      products: products.map((product) => ({
        ...product,
        salesCount: salesByProductId.get(String(product.id)) ?? 0,
      })),
    }));

    return {
      merchant: {
        id: merchant.id,
        nameZh: merchant.nameZh,
        nameVi: merchant.nameVi,
        isOpen: isMerchantOpen(merchant),
      },
      categories: categoriesWithSales,
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
        signatureDishes: {
          where: { isVisible: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            nameZh: true,
            nameVi: true,
            nameEn: true,
            imageUrl: true,
            sortOrder: true,
          },
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
    categories: Array<Pick<Category, 'nameZh' | 'nameVi' | 'nameEn'>>,
    distance: number | null,
    hotRecommendations: PublicMerchantRow['hotRecommendations'] = [],
    signatureDishes: NonNullable<PublicMerchantRow['signatureDishes']> = merchant.signatureDishes ?? [],
    includeDetailDisplayTags = false,
  ) {
    const resolvedCapabilities =
      this.merchantCapabilities.resolveCapabilitiesFromMerchant(merchant);
    const qrOrderEnabled = this.merchantCapabilities.resolveCapabilityFlag(
      merchant,
      'qrOrderEnabled',
      false,
    );
    const platformOrderingEnabled = this.appConfig.isPlatformOrderingEnabled();
    const claimedMerchant = isClaimedMerchant(merchant);
    const pickupEnabled = platformOrderingEnabled && claimedMerchant
      ? resolvedCapabilities.pickupEnabled
      : false;
    const deliveryEnabled = platformOrderingEnabled && claimedMerchant
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
        ? supportedOrderTypes(merchant, { pickupEnabled, deliveryEnabled })
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
      promotionTags: (merchant.promotionTags ?? [])
        .filter((item) => item.promotionTag.scope === PromotionTagScope.OPERATIONAL)
        .map((item) => ({
          id: item.promotionTag.id.toString(),
          code: item.promotionTag.code,
          scope: PromotionTagScope.OPERATIONAL,
          nameZh: item.promotionTag.nameZh,
          nameVi: item.promotionTag.nameVi,
          nameEn: item.promotionTag.nameEn,
          iconText: item.promotionTag.iconText,
          color: item.promotionTag.color,
        })),
      ...(includeDetailDisplayTags
        ? { detailDisplayTags: resolveDetailDisplayTags(merchant.promotionTags ?? []) }
        : {}),
      capabilities: (merchant.capabilities ?? []).map((item) => {
        const orderingAllowed = platformOrderingEnabled
          || !isOrderingCapabilityCode(item.capability.code);
        const claimedOnlyAllowed = !isClaimedOnlyOrderingCapability(item.capability.code)
          || claimedMerchant;
        return {
          id: item.capability.id.toString(),
          code: item.capability.code,
          nameZh: item.capability.nameZh,
          nameVi: item.capability.nameVi,
          nameEn: item.capability.nameEn,
          isEnabled: orderingAllowed && claimedOnlyAllowed ? item.isEnabled : false,
        };
      }),
      images: (merchant.images ?? []).map((item) => ({
        id: item.id.toString(),
        imageType: item.imageType,
        imageUrl: item.imageUrl,
        titleZh: item.titleZh,
        titleVi: item.titleVi,
        titleEn: item.titleEn,
        sortOrder: item.sortOrder,
      })),
      signatureDishes: signatureDishes.map((item) => ({
        id: item.id.toString(),
        nameZh: item.nameZh,
        nameVi: item.nameVi,
        nameEn: item.nameEn,
        imageUrl: item.imageUrl,
        sortOrder: item.sortOrder,
      })),
      hotRecommendations: (hotRecommendations ?? []).map((item) => ({
        id: item.id.toString(),
        nameZh: item.nameZh,
        nameVi: item.nameVi,
        nameEn: item.nameEn,
        imageUrl: item.imageUrl,
        priceVnd: item.priceVnd.toString(),
        salesCount: item.salesCount,
        hotRank: item.hotRank,
      })),
      categoryNames: categories.flatMap((category) =>
        [category.nameZh, category.nameVi, category.nameEn].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    };
  }

  private async salesByProductId(merchantId: bigint) {
    const productSales = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { not: null },
        order: {
          merchantId,
          status: 'COMPLETED',
          orderType: { in: SALES_ORDER_TYPES },
        },
      },
      _sum: { quantity: true },
    });
    return new Map(
      productSales.map((sale) => [String(sale.productId), sale._sum?.quantity ?? 0]),
    );
  }

  private async resolveSignatureDishes(
    merchant: PublicMerchantRow,
  ): Promise<NonNullable<PublicMerchantRow['signatureDishes']>> {
    if (!isClaimedMerchant(merchant)) return merchant.signatureDishes ?? [];

    const category = await this.prisma.category.findFirst({
      where: {
        merchantId: merchant.id,
        isSignature: true,
        isActive: true,
      },
      select: {
        products: {
          where: {
            productType: 'FOOD',
            status: { in: ['ON_SALE', 'SOLD_OUT'] },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 15,
          select: {
            id: true,
            nameZh: true,
            nameVi: true,
            nameEn: true,
            imageUrl: true,
            sortOrder: true,
          },
        },
      },
    });
    return (category?.products ?? []).map((product) => ({
      ...product,
      imageUrl: product.imageUrl ?? '',
    }));
  }

  private async hotRecommendations(merchantId: bigint) {
    const [categories, salesByProductId] = await Promise.all([
      this.prisma.category.findMany({
        where: { merchantId, isActive: true },
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
      }),
      this.salesByProductId(merchantId),
    ]);
    const candidates: Array<{
      product: (typeof categories)[number]['products'][number];
      index: number;
    }> = [];
    categories.forEach((category) => {
      if (isHotRecommendationCategory(category.nameZh)) return;
      category.products.forEach((product) => {
        if ((salesByProductId.get(String(product.id)) ?? 0) > 0) {
          candidates.push({ product, index: candidates.length });
        }
      });
    });
    return candidates
      .sort(
        (left, right) =>
          (salesByProductId.get(String(right.product.id)) ?? 0) -
            (salesByProductId.get(String(left.product.id)) ?? 0) ||
          left.index - right.index,
      )
      .slice(0, 8)
      .map(({ product }, index) => ({
        id: product.id,
        nameZh: product.nameZh,
        nameVi: product.nameVi,
        nameEn: product.nameEn,
        imageUrl: product.imageUrl,
        priceVnd: product.priceVnd,
        salesCount: salesByProductId.get(String(product.id)) ?? 0,
        hotRank: index + 1,
      }));
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

function resolveDetailDisplayTags(
  relations: NonNullable<PublicMerchantRow['promotionTags']>,
) {
  const byScope = (scope: PromotionTagScope) => relations
    .filter((item) => item.promotionTag.scope === scope)
    .sort((left, right) => (
      left.promotionTag.sortOrder - right.promotionTag.sortOrder
      || Number(left.promotionTag.id - right.promotionTag.id)
    ))
    .slice(0, 2)
    .map((item) => ({
      id: item.promotionTag.id.toString(),
      code: item.promotionTag.code,
      scope: item.promotionTag.scope,
      nameZh: item.promotionTag.nameZh,
      nameVi: item.promotionTag.nameVi,
      nameEn: item.promotionTag.nameEn,
      iconText: item.promotionTag.iconText,
      color: item.promotionTag.color,
    }));

  return [
    ...byScope(PromotionTagScope.CUISINE),
    ...byScope(PromotionTagScope.SCENE),
  ].slice(0, 4);
}

function isHotRecommendationCategory(nameZh: string) {
  return ['米饭', '饮料', '饮品', '酒水'].some((keyword) => nameZh.includes(keyword));
}

function isClaimedMerchant(merchant: PublicMerchantRow) {
  return merchant.merchantMode === 'MANAGED' && merchant.claimStatus === 'CLAIMED';
}

function isClaimedOnlyOrderingCapability(code: string) {
  return code === 'pickupEnabled' || code === 'deliveryEnabled';
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

function matchesHomepageCategory(
  merchant: HomepageMerchantListItem,
  categoryKey?: HomepageCategoryKey,
) {
  if (!categoryKey) return true;
  const categoryKeys = parseHomepageCategoryKeys(merchant.homepageCategoryKeys);
  if (categoryKeys.includes(categoryKey)) return true;
  if (categoryKey !== 'popular_food') return false;
  return Boolean(merchant.manualPopular)
    || merchant.promotionTags.some((tag) => tag.code === 'HOT_FOOD');
}

function matchesMerchantKeyword(
  merchant: HomepageMerchantListItem,
  rawKeyword?: string,
) {
  const keyword = normalizeSearchText(rawKeyword);
  if (!keyword) return true;
  return [
    merchant.nameZh,
    merchant.nameVi,
    merchant.nameEn,
    merchant.addressDetail,
  ].some((value) => normalizeSearchText(value).includes(keyword));
}

function matchesServiceFilters(
  merchant: HomepageMerchantListItem,
  filters: NearbyMerchantsQueryDto['serviceFilter'],
) {
  return (filters ?? []).every((filter) => {
    if (filter === 'OPEN') return merchant.isOpen;
    return merchant.supportedOrderTypes.includes(filter);
  });
}

function isFeaturedMerchant(
  merchant: HomepageMerchantListItem,
) {
  return merchant.promotionTags.some((tag) => tag.code === 'FEATURED');
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function compareMerchantIds(left: bigint | string, right: bigint | string) {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}

type HomepageMerchantListItem = {
  id: bigint | string;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  addressDetail: string | null;
  distanceKm: number | null;
  isOpen: boolean;
  supportedOrderTypes: Array<string | null>;
  homepageCategoryKeys: unknown;
  manualPopular: boolean;
  promotionTags: Array<{ code: string }>;
};
