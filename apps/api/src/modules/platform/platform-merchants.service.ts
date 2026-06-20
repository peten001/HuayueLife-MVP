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
  StaffRole,
  StaffStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { CreatePlatformMerchantDto } from './dto/create-platform-merchant.dto';
import { UpdatePlatformMerchantDto } from './dto/update-platform-merchant.dto';

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

const HOMEPAGE_CATEGORY_KEYS = new Set(['chinese', 'noodles', 'drinks']);

function stringifyHomepageCategoryKeys(value: string[] | undefined) {
  if (!value) return '[]';
  return JSON.stringify(
    Array.from(new Set(value.filter((item) => HOMEPAGE_CATEGORY_KEYS.has(item)))),
  );
}

function parseHomepageCategoryKeys(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => HOMEPAGE_CATEGORY_KEYS.has(item));
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => HOMEPAGE_CATEGORY_KEYS.has(item))
      : [];
  } catch {
    return [];
  }
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
