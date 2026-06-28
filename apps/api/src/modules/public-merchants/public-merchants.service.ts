import {
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
const CITY_VARIANTS: Record<'Bac Giang' | 'Bac Ninh', string[]> = {
  'Bac Giang': [
    'Bac Giang',
    'Bắc Giang',
    'bac giang',
    'bacgiang',
    'Bac Giang Province',
    'Bắc Giang Province',
    '北江',
    '北江省',
  ],
  'Bac Ninh': [
    'Bac Ninh',
    'Bắc Ninh',
    'bac ninh',
    'bacninh',
    'Bac Ninh Province',
    'Bắc Ninh Province',
    '北宁',
    '北宁省',
  ],
};

@Injectable()
export class PublicMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async nearby(query: NearbyMerchantsQueryDto) {
    console.log('[public-merchants] nearby query', query);
    const resolvedCity =
      resolveCity(query.city) ??
      inferCityByLocation(query.lat, query.lng) ??
      'Bac Giang';
    console.log('[public-merchants] nearby city', query.city);
    console.log('[public-merchants] normalized city', resolvedCity);

    const where: Prisma.MerchantWhereInput = {
      status: 'ACTIVE',
      merchantType: 'RESTAURANT',
      isVisibleOnClient: true,
    };

    const include = {
      categories: {
        where: { isActive: true },
        select: {
          nameZh: true,
          nameVi: true,
        },
      },
    } satisfies Prisma.MerchantInclude;

    let merchants: Array<Merchant & { categories?: Array<Pick<Category, 'nameZh' | 'nameVi'>> }>;
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

    const cityMatched = merchants.filter((merchant) =>
      merchantMatchesCity(merchant, resolvedCity),
    );
    console.log('[public-merchants] city matched count', cityMatched.length);

    const effectiveMerchants = cityMatched.length ? cityMatched : merchants;
    if (!cityMatched.length && merchants.length) {
      console.warn('[public-merchants] city query empty, fallback to active merchants', {
        resolvedCity,
      });
    }

    const results = effectiveMerchants
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
          merchantType: 'RESTAURANT',
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
        merchantType: 'RESTAURANT',
        isVisibleOnClient: true,
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
      include: { merchant: true },
    });
    if (!table) {
      throw new NotFoundException('Merchant not found or unavailable');
    }
    if (table.status !== 'ACTIVE') {
      throw new GoneException('该桌台已停用');
    }
    if (
      table.merchant.status !== 'ACTIVE' ||
      table.merchant.merchantType !== 'RESTAURANT'
    ) {
      throw new GoneException('商家当前不可用');
    }
    if (!table.merchant.dineInEnabled) {
      throw new GoneException('商家当前未开启堂食');
    }
    return table;
  }

  private toMerchantSummary(
    merchant: Merchant & { categories?: Array<Pick<Category, 'nameZh' | 'nameVi'>> },
  ) {
    return this.serializeMerchant(merchant, merchant.categories ?? [], null);
  }

  private serializeMerchant(
    merchant: Merchant,
    categories: Array<Pick<Category, 'nameZh' | 'nameVi'>>,
    distance: number | null,
  ) {
    return {
      ...merchant,
      id: merchant.id,
      nameZh: merchant.nameZh,
      nameVi: merchant.nameVi,
      coverUrl: merchant.coverUrl,
      addressDetail: merchant.addressDetail,
      city: merchant.city,
      distanceKm: distance === null ? null : Number(distance.toFixed(2)),
      isOpen: isMerchantOpen(merchant),
      supportedOrderTypes: supportedOrderTypes(merchant),
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd.toString(),
      deliveryFeeVnd: merchant.deliveryFeeVnd.toString(),
      latitude: merchant.latitude.toString(),
      longitude: merchant.longitude.toString(),
      deliveryRadiusKm: merchant.deliveryRadiusKm.toString(),
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
      categoryNames: categories.flatMap((category) =>
        [category.nameZh, category.nameVi].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    };
  }
}

function supportedOrderTypes(merchant: Merchant) {
  return [
    merchant.dineInEnabled ? 'DINE_IN' : null,
    merchant.pickupEnabled ? 'PICKUP' : null,
    merchant.deliveryEnabled ? 'DELIVERY' : null,
  ].filter(Boolean);
}

function resolveCity(city?: string) {
  const normalized = normalizeCityText(city);
  if (!normalized) return null;
  if (normalized.includes('bacgiang') || normalized.includes('北江')) return 'Bac Giang';
  if (normalized.includes('bacninh') || normalized.includes('北宁')) return 'Bac Ninh';
  return null;
}

function inferCityByLocation(lat?: number, lng?: number) {
  if (lat === undefined || lng === undefined) return null;
  if (lat >= 21.2) return 'Bac Giang';
  if (lat <= 21.18) return 'Bac Ninh';
  if (lng >= 106.08) return 'Bac Giang';
  return 'Bac Ninh';
}

function merchantMatchesCity(
  merchant: Merchant,
  city: 'Bac Giang' | 'Bac Ninh',
) {
  const cityKey = normalizeCityText(city);
  const aliases = CITY_VARIANTS[city] ?? [cityKey];
  const haystack = [
    merchant.city,
    merchant.province,
    merchant.district,
    merchant.addressDetail,
    merchant.nameZh,
    merchant.nameVi,
  ]
    .filter(Boolean)
    .map((value) => normalizeCityText(String(value)));
  if (!haystack.length) return true;
  return aliases.some((alias) =>
    haystack.some((value) => value.includes(normalizeCityText(alias))),
  );
}

function normalizeCityText(value?: string) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
