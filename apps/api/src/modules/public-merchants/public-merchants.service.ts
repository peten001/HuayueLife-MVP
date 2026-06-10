import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Merchant, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { NearbyMerchantsQueryDto } from './dto/nearby-merchants-query.dto';

const PAGE_SIZE = 20;
const CITY_ALIASES: Record<string, string> = {
  北宁: 'Bac Ninh',
  北江: 'Bac Giang',
  'Bac Ninh': 'Bac Ninh',
  'Bac Giang': 'Bac Giang',
};

@Injectable()
export class PublicMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async nearby(query: NearbyMerchantsQueryDto) {
    const hasLocation = query.lat !== undefined && query.lng !== undefined;
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new BadRequestException('lat and lng must be provided together');
    }
    if (!hasLocation && !query.city) {
      throw new BadRequestException(
        'city is required when location is unavailable',
      );
    }

    const where: Prisma.MerchantWhereInput = {
      status: 'ACTIVE',
      merchantType: 'RESTAURANT',
    };

    if (hasLocation) {
      const latitudeDelta = query.radiusKm / 111.32;
      const longitudeDelta =
        query.radiusKm /
        (111.32 * Math.max(Math.cos((query.lat! * Math.PI) / 180), 0.01));
      where.latitude = {
        gte: query.lat! - latitudeDelta,
        lte: query.lat! + latitudeDelta,
      };
      where.longitude = {
        gte: query.lng! - longitudeDelta,
        lte: query.lng! + longitudeDelta,
      };
    } else {
      where.OR = [
        { city: CITY_ALIASES[query.city!] },
        { province: CITY_ALIASES[query.city!] },
      ];
    }

    const merchants = await this.prisma.merchant.findMany({ where });
    const results = merchants
      .map((merchant) =>
        this.toMerchantSummary(
          merchant,
          hasLocation
            ? distanceKm(
                query.lat!,
                query.lng!,
                Number(merchant.latitude),
                Number(merchant.longitude),
              )
            : null,
        ),
      )
      .filter(
        (merchant) =>
          merchant.distanceKm === null ||
          merchant.distanceKm <= query.radiusKm,
      )
      .sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        return a.nameZh.localeCompare(b.nameZh, 'zh-CN');
      });

    const start = (query.page - 1) * PAGE_SIZE;
    return {
      items: results.slice(start, start + PAGE_SIZE),
      page: query.page,
      pageSize: PAGE_SIZE,
      total: results.length,
      locationMode: hasLocation ? 'GPS' : 'CITY',
    };
  }

  async detail(id: bigint) {
    const merchant = await this.requirePublicMerchant(id);
    return {
      ...merchant,
      isOpen: isMerchantOpen(merchant),
      supportedOrderTypes: supportedOrderTypes(merchant),
    };
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

  private toMerchantSummary(merchant: Merchant, distance: number | null) {
    return {
      id: merchant.id,
      nameZh: merchant.nameZh,
      nameVi: merchant.nameVi,
      coverUrl: merchant.coverUrl,
      addressDetail: merchant.addressDetail,
      city: merchant.city,
      distanceKm: distance === null ? null : Number(distance.toFixed(2)),
      isOpen: isMerchantOpen(merchant),
      supportedOrderTypes: supportedOrderTypes(merchant),
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd,
      deliveryFeeVnd: merchant.deliveryFeeVnd,
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
