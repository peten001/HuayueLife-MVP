import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Merchant,
  MerchantStatus,
  OrderStatus,
  OrderType,
  ProductStatus,
  StaffRole,
  StaffStatus,
  TableStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { CreatePlatformMerchantDto } from './dto/create-platform-merchant.dto';
import { UpdatePlatformMerchantDto } from './dto/update-platform-merchant.dto';
import {
  parseHomepageCategoryKeys,
  stringifyHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

type MerchantWithOwner = Merchant & {
  staff: Array<{
    id: bigint;
    username: string;
    mustChangePassword: boolean;
    status: StaffStatus;
    role: StaffRole;
  }>;
};

type PlatformMerchantListItem = {
  id: string;
  nameZh: string;
  city: string;
  district?: string | null;
  contactPhone: string;
  homepageCategoryKeys: string[];
  manualPopular: boolean;
  status: MerchantStatus;
  createdAt: string;
  updatedAt: string;
  ownerUsername: string;
  ownerMustChangePassword: boolean;
  ownerStatus: StaffStatus;
  profileCompletion: number;
  missingProfileFields: string[];
  todayOrderCount: number;
  todayOrderAmount: string;
  pendingAcceptanceOrderCount: number;
  preparingOrderCount: number;
  last7DaysOrderCount: number;
  lastOrderAt: string | null;
};

type MerchantOperationStats = {
  todayOrderCount: number;
  todayOrderAmount: string;
  pendingAcceptanceOrderCount: number;
  preparingOrderCount: number;
  last7DaysOrderCount: number;
  lastOrderAt: string | null;
};

type PlatformMerchantDetailResponse = {
  merchant: {
    id: string;
    name: string;
    account: string;
    phone: string;
    city: string;
    district: string | null;
    address: string;
    status: MerchantStatus;
    isActive: boolean;
    logoUrl: string | null;
    coverUrl: string | null;
    homepageCategoryKeys: string[];
    manualPopular: boolean;
    profileCompletion: number;
    createdAt: string;
    updatedAt: string;
  };
  metrics: {
    todayOrderCount: number;
    todayOrderAmount: string;
    pendingAcceptanceOrderCount: number;
    preparingOrderCount: number;
    last7DaysOrderCount: number;
    last7DaysOrderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    completionRate: number | null;
    averageOrderAmount: string | null;
    lastOrderAt: string | null;
  };
  trend: Array<{
    date: string;
    orderCount: number;
    orderAmount: string;
  }>;
  operation: {
    menuCategoryCount: number;
    dishCount: number;
    activeDishCount: number;
    tableCount: number;
    activeTableCount: number;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    orderType: OrderType;
    status: OrderStatus;
    totalAmount: string;
    contactPhone: string | null;
    createdAt: string;
  }>;
};

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PREPARING_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];

const DEFAULT_BUSINESS_HOURS = {
  monday: ['10:00-22:00'],
  tuesday: ['10:00-22:00'],
  wednesday: ['10:00-22:00'],
  thursday: ['10:00-22:00'],
  friday: ['10:00-22:00'],
  saturday: ['10:00-22:00'],
  sunday: ['10:00-22:00'],
};

@Injectable()
export class PlatformMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const now = new Date();
    const todayStart = startOfVietnamDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const last7Start = addDays(todayStart, -6);
    const merchants = await this.prisma.merchant.findMany({
      where: {
        status: { not: MerchantStatus.DELETED },
      },
      include: {
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const merchantIds = merchants.map((merchant) => merchant.id);
    const operationStats = await this.loadOperationStats(
      merchantIds,
      todayStart,
      tomorrowStart,
      last7Start,
    );

    return {
      items: merchants.map((merchant) =>
        this.toListItem(merchant, operationStats.get(merchant.id.toString())),
      ),
    };
  }

  async detail(id: bigint): Promise<PlatformMerchantDetailResponse> {
    const merchant = await this.requireMerchant(id);
    const now = new Date();
    const todayStart = startOfVietnamDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const last7Start = addDays(todayStart, -6);

    const [
      todayStats,
      last7Stats,
      currentPendingCount,
      currentPreparingCount,
      allTimeStats,
      canceledOrderCount,
      recentOrders,
      menuCategoryCount,
      dishCount,
      activeDishCount,
      tableCount,
      activeTableCount,
      lastOrder,
      trendOrders,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: OrderStatus.PENDING_ACCEPTANCE,
        },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: { in: PREPARING_STATUSES },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: OrderStatus.CANCELLED,
        },
      }),
      this.prisma.order.findMany({
        where: { merchantId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          orderNo: true,
          orderType: true,
          status: true,
          totalAmountVnd: true,
          contactPhone: true,
          createdAt: true,
        },
      }),
      this.prisma.category.count({
        where: { merchantId: id },
      }),
      this.prisma.product.count({
        where: { merchantId: id },
      }),
      this.prisma.product.count({
        where: { merchantId: id, status: ProductStatus.ON_SALE },
      }),
      this.prisma.diningTable.count({
        where: { merchantId: id },
      }),
      this.prisma.diningTable.count({
        where: { merchantId: id, status: TableStatus.ACTIVE },
      }),
      this.prisma.order.findFirst({
        where: { merchantId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        select: {
          totalAmountVnd: true,
          createdAt: true,
        },
      }),
    ]);

    const activeCount = Number(allTimeStats._count._all ?? 0);
    const completedOrderCount = await this.prisma.order.count({
      where: {
        merchantId: id,
        status: OrderStatus.COMPLETED,
      },
    });
    const totalAllTimeAmount = allTimeStats._sum.totalAmountVnd ?? 0n;
    const profile = this.computeProfileCompletion(merchant);

    return {
      merchant: {
        id: merchant.id.toString(),
        name: merchant.nameZh,
        account:
          merchant.staff.find((item) => item.role === StaffRole.OWNER)?.username ??
          merchant.contactPhone,
        phone: merchant.contactPhone,
        city: merchant.city,
        district: merchant.district,
        address: merchant.addressDetail,
        status: merchant.status,
        isActive: merchant.status === MerchantStatus.ACTIVE,
        logoUrl: merchant.logoUrl,
        coverUrl: merchant.coverUrl,
        homepageCategoryKeys: parseHomepageCategoryKeys(merchant.homepageCategoryKeys),
        manualPopular: Boolean(merchant.manualPopular),
        profileCompletion: profile.completion,
        createdAt: merchant.createdAt.toISOString(),
        updatedAt: merchant.updatedAt.toISOString(),
      },
      metrics: {
        todayOrderCount: Number(todayStats._count._all ?? 0),
        todayOrderAmount: (todayStats._sum.totalAmountVnd ?? 0n).toString(),
        pendingAcceptanceOrderCount: currentPendingCount,
        preparingOrderCount: currentPreparingCount,
        last7DaysOrderCount: Number(last7Stats._count._all ?? 0),
        last7DaysOrderAmount: (last7Stats._sum.totalAmountVnd ?? 0n).toString(),
        completedOrderCount,
        canceledOrderCount,
        completionRate:
          activeCount > 0 ? Math.round((completedOrderCount / activeCount) * 100) : null,
        averageOrderAmount:
          activeCount > 0 ? (totalAllTimeAmount / BigInt(activeCount)).toString() : null,
        lastOrderAt: lastOrder?.createdAt.toISOString() ?? null,
      },
      trend: buildTrendRows(last7Start, trendOrders),
      operation: {
        menuCategoryCount,
        dishCount,
        activeDishCount,
        tableCount,
        activeTableCount,
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id.toString(),
        orderNo: order.orderNo,
        orderType: order.orderType,
        status: order.status,
        totalAmount: order.totalAmountVnd.toString(),
        contactPhone: order.contactPhone,
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  async create(dto: CreatePlatformMerchantDto) {
    const phone = dto.phone.trim();
    const existingOwner = await this.prisma.merchantStaff.findFirst({
      where: { username: phone },
      select: { id: true },
    });
    if (existingOwner) {
      throw new ConflictException('该手机号已存在');
    }

    const generatedName = `新商户-${phone}`;
    const passwordHash = await bcrypt.hash('12345678', 12);
    const merchant = await this.prisma.merchant.create({
      data: {
        nameZh: generatedName,
        nameVi: null,
        merchantType: 'RESTAURANT',
        logoUrl: null,
        coverUrl: null,
        contactName: phone,
        contactPhone: phone,
        province: '待完善',
        city: '待完善',
        district: null,
        addressDetail: '待完善',
        latitude: 0,
        longitude: 0,
        businessHours: DEFAULT_BUSINESS_HOURS,
        notice: null,
        minimumDeliveryAmountVnd: 0n,
        deliveryFeeVnd: 0n,
        deliveryRadiusKm: 0,
        dineInEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: false,
        homepageCategoryKeys: stringifyHomepageCategoryKeys(
          dto.homepageCategoryKeys,
        ),
        manualPopular: Boolean(dto.manualPopular),
        status: MerchantStatus.ACTIVE,
        staff: {
          create: {
            username: phone,
            displayName: `${generatedName}老板`,
            passwordHash,
            role: StaffRole.OWNER,
            status: StaffStatus.ACTIVE,
            mustChangePassword: true,
          },
        },
      },
      include: {
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
      },
    });

    return this.toListItem(merchant, emptyOperationStats());
  }

  async update(id: bigint, dto: UpdatePlatformMerchantDto) {
    await this.requireMerchant(id);
    const data: Record<string, unknown> = {};
    if (dto.nameZh !== undefined) {
      data.nameZh = dto.nameZh.trim();
    }
    if (dto.contactPhone !== undefined) {
      data.contactPhone = dto.contactPhone.trim();
    }
    if (dto.homepageCategoryKeys !== undefined) {
      data.homepageCategoryKeys = stringifyHomepageCategoryKeys(
        dto.homepageCategoryKeys,
      );
    }
    if (dto.manualPopular !== undefined) {
      data.manualPopular = dto.manualPopular;
    }

    await this.prisma.merchant.update({
      where: { id },
      data,
    });

    return this.findById(id);
  }

  async disable(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.DISABLED },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.DISABLED },
      });
    });
    return this.findById(id);
  }

  async enable(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.ACTIVE },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.ACTIVE },
      });
    });
    return this.findById(id);
  }

  async resetPassword(id: bigint) {
    const merchant = await this.requireMerchant(id);
    const owner = merchant.staff.find((item) => item.role === StaffRole.OWNER);
    if (!owner) {
      throw new NotFoundException('OWNER account not found');
    }
    const passwordHash = await bcrypt.hash('12345678', 12);
    await this.prisma.merchantStaff.update({
      where: { id: owner.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        status: StaffStatus.ACTIVE,
      },
    });
    return this.findById(id);
  }

  async delete(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.DELETED },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.DISABLED },
      });
    });
    return this.findById(id);
  }

  private async findById(id: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.toListItem(merchant, emptyOperationStats());
  }

  private async requireMerchant(id: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return merchant as MerchantWithOwner;
  }

  private toListItem(
    merchant: MerchantWithOwner,
    stats = emptyOperationStats(),
  ): PlatformMerchantListItem {
    const owner = merchant.staff.find((item) => item.role === StaffRole.OWNER);
    const profile = this.computeProfileCompletion(merchant);
    return {
      id: merchant.id.toString(),
      nameZh: merchant.nameZh,
      city: merchant.city,
      district: merchant.district,
      contactPhone: merchant.contactPhone,
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
      status: merchant.status,
      createdAt: merchant.createdAt.toISOString(),
      updatedAt: merchant.updatedAt.toISOString(),
      ownerUsername: owner?.username ?? '',
      ownerMustChangePassword: owner?.mustChangePassword ?? false,
      ownerStatus: owner?.status ?? StaffStatus.DISABLED,
      profileCompletion: profile.completion,
      missingProfileFields: profile.missingFields,
      todayOrderCount: stats.todayOrderCount,
      todayOrderAmount: stats.todayOrderAmount,
      pendingAcceptanceOrderCount: stats.pendingAcceptanceOrderCount,
      preparingOrderCount: stats.preparingOrderCount,
      last7DaysOrderCount: stats.last7DaysOrderCount,
      lastOrderAt: stats.lastOrderAt,
    };
  }

  private async loadOperationStats(
    merchantIds: bigint[],
    todayStart: Date,
    tomorrowStart: Date,
    last7Start: Date,
  ) {
    const stats = new Map<string, MerchantOperationStats>();
    for (const merchantId of merchantIds) {
      stats.set(merchantId.toString(), emptyOperationStats());
    }
    if (!merchantIds.length) return stats;

    const [
      todayGroups,
      pendingGroups,
      preparingGroups,
      last7Groups,
      lastOrderGroups,
    ] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: OrderStatus.PENDING_ACCEPTANCE,
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { in: PREPARING_STATUSES },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: merchantIds } },
        _max: { createdAt: true },
      }),
    ]);

    for (const item of todayGroups) {
      const row = stats.get(item.merchantId.toString());
      if (!row) continue;
      row.todayOrderCount = item._count._all;
      row.todayOrderAmount = (item._sum.totalAmountVnd ?? 0n).toString();
    }
    for (const item of pendingGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.pendingAcceptanceOrderCount = item._count._all;
    }
    for (const item of preparingGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.preparingOrderCount = item._count._all;
    }
    for (const item of last7Groups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.last7DaysOrderCount = item._count._all;
    }
    for (const item of lastOrderGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.lastOrderAt = item._max.createdAt?.toISOString() ?? null;
    }

    return stats;
  }

  private computeProfileCompletion(merchant: Merchant) {
    const total = 9;
    const missingFields: string[] = [];

    if (!merchant.nameZh?.trim() || merchant.nameZh.startsWith('新商户-')) {
      missingFields.push('merchantName');
    }
    if (!merchant.logoUrl?.trim()) {
      missingFields.push('logoUrl');
    }
    if (!merchant.coverUrl?.trim()) {
      missingFields.push('coverUrl');
    }
    if (!merchant.province?.trim() || merchant.province === '待完善') {
      missingFields.push('province');
    }
    if (!merchant.city?.trim() || merchant.city === '待完善') {
      missingFields.push('city');
    }
    if (!merchant.district?.trim() || merchant.district === '待完善') {
      missingFields.push('district');
    }
    if (!merchant.addressDetail?.trim() || merchant.addressDetail === '待完善') {
      missingFields.push('addressDetail');
    }
    if (!this.hasBusinessHours(merchant.businessHours)) {
      missingFields.push('businessHoursSection');
    }
    if (!merchant.contactPhone?.trim()) {
      missingFields.push('contactPhone');
    }

    const completion = Math.max(0, Math.min(100, Math.round(((total - missingFields.length) / total) * 100)));
    return { completion, missingFields };
  }

  private hasBusinessHours(value: Merchant['businessHours']) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const hours = value as Record<string, unknown>;
    return Object.values(hours).some(
      (items) =>
        Array.isArray(items) &&
        items.some((item) => typeof item === 'string' && item.trim().length > 0),
    );
  }
}


function buildTrendRows(
  start: Date,
  orders: Array<{ totalAmountVnd: bigint; createdAt: Date }>,
) {
  const rows = new Map<string, { date: string; orderCount: number; orderAmount: bigint }>();
  for (let index = 0; index < 7; index += 1) {
    const date = formatVietnamDate(addDays(start, index));
    rows.set(date, { date, orderCount: 0, orderAmount: 0n });
  }

  for (const order of orders) {
    const date = formatVietnamDate(order.createdAt);
    const row = rows.get(date);
    if (!row) continue;
    row.orderCount += 1;
    row.orderAmount += order.totalAmountVnd;
  }

  return Array.from(rows.values()).map((row) => ({
    date: row.date,
    orderCount: row.orderCount,
    orderAmount: row.orderAmount.toString(),
  }));
}

function formatVietnamDate(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  const year = vietnamTime.getUTCFullYear();
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyOperationStats(): MerchantOperationStats {
  return {
    todayOrderCount: 0,
    todayOrderAmount: '0',
    pendingAcceptanceOrderCount: 0,
    preparingOrderCount: 0,
    last7DaysOrderCount: 0,
    lastOrderAt: null,
  };
}

function startOfVietnamDay(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(
      vietnamTime.getUTCFullYear(),
      vietnamTime.getUTCMonth(),
      vietnamTime.getUTCDate(),
    ) - VIETNAM_OFFSET_MS,
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
