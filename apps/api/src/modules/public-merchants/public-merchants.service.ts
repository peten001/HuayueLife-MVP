import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Merchant, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isMerchantOpen } from '../../common/utils/merchant-hours';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';

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
    const resolvedCity =
      resolveCity(query.city) ??
      inferCityByLocation(query.lat, query.lng) ??
      'Bac Giang';

    const where: Prisma.MerchantWhereInput = {
      status: 'ACTIVE',
      merchantType: 'RESTAURANT',
    };

    const cityWhere = cityWhereConditions(resolvedCity);

    console.log('[public-merchants] nearby query', {
      city: query.city,
      lat: query.lat,
      lng: query.lng,
      resolvedCity,
    });

    const include = {
      categories: {
        where: { isActive: true },
        select: {
          nameZh: true,
          nameVi: true,
        },
      },
    } satisfies Prisma.MerchantInclude;

    let merchants = await this.prisma.merchant.findMany({
      where: { ...where, OR: cityWhere },
      include,
    });
    console.log('[public-merchants] city query count', merchants.length);
    if (!merchants.length) {
      console.warn('[public-merchants] city query empty, fallback to active merchants', {
        resolvedCity,
      });
      merchants = await this.prisma.merchant.findMany({
        where,
        include,
      });
      console.log('[public-merchants] fallback active count', merchants.length);
    }
    const results = merchants
      .map((merchant) => this.toMerchantSummary(merchant))
      .sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        return a.nameZh.localeCompare(b.nameZh, 'zh-CN');
      });

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

  async menu(id: bigint) {
    const merchant = await this.requirePublicMerchant(id);
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

  async product(id: bigint) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        productType: 'FOOD',
        status: { in: ['ON_SALE', 'SOLD_OUT'] },
        category: { isActive: true },
        merchant: {
          status: 'ACTIVE',
          merchantType: 'RESTAURANT',
        },
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
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        merchantType: 'RESTAURANT',
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found or unavailable');
    }
    return merchant;
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

function cityWhereConditions(city: 'Bac Giang' | 'Bac Ninh'): Prisma.MerchantWhereInput[] {
  const variants = CITY_VARIANTS[city];
  return variants.flatMap((variant) => [
    { city: { contains: variant, mode: 'insensitive' } },
    { province: { contains: variant, mode: 'insensitive' } },
    { district: { contains: variant, mode: 'insensitive' } },
    { addressDetail: { contains: variant, mode: 'insensitive' } },
    { nameZh: { contains: variant, mode: 'insensitive' } },
    { nameVi: { contains: variant, mode: 'insensitive' } },
  ]);
}

function normalizeCityText(value?: string) {
  return (value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
