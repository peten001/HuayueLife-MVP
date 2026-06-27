import { Injectable } from '@nestjs/common';
import { MerchantStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { parseHomepageCategoryKeys } from '../shared/homepage-category-keys';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PREPARING_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];

@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = startOfVietnamDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const last7Start = addDays(todayStart, -6);
    const longPendingBefore = new Date(now.getTime() - 10 * 60 * 1000);

    const [
      todayOrderCount,
      todayOrderAmount,
      todayActiveMerchantCount,
      todayNewMerchantCount,
      pendingAcceptanceOrderCount,
      preparingOrderCount,
      longPendingOrderCount,
      cancelledGroups,
      merchantsForHomepageCheck,
      trendOrders,
      rankingGroups,
    ] = await Promise.all([
      this.prisma.order.count({
        where: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.merchant.count({
        where: {
          status: { not: MerchantStatus.DELETED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.PENDING_ACCEPTANCE },
      }),
      this.prisma.order.count({
        where: { status: { in: PREPARING_STATUSES } },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.PENDING_ACCEPTANCE,
          createdAt: { lt: longPendingBefore },
        },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          status: OrderStatus.CANCELLED,
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        _count: { _all: true },
      }),
      this.prisma.merchant.findMany({
        where: { status: { not: MerchantStatus.DELETED } },
        select: { homepageCategoryKeys: true },
      }),
      this.prisma.order.findMany({
        where: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        select: {
          merchantId: true,
          totalAmountVnd: true,
          createdAt: true,
        },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
        orderBy: [{ _count: { id: 'desc' } }],
        take: 5,
      }),
    ]);

    const merchantIds = rankingGroups.map((item) => item.merchantId);
    const rankingMerchants = merchantIds.length
      ? await this.prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: {
            id: true,
            nameZh: true,
            city: true,
            district: true,
            status: true,
          },
        })
      : [];
    const merchantById = new Map(
      rankingMerchants.map((merchant) => [merchant.id.toString(), merchant]),
    );

    return {
      overview: {
        todayOrderCount,
        todayOrderAmount: (todayOrderAmount._sum.totalAmountVnd ?? 0n).toString(),
        todayActiveMerchantCount: todayActiveMerchantCount.length,
        todayNewMerchantCount,
        pendingAcceptanceOrderCount,
        preparingOrderCount,
      },
      alerts: {
        longPendingOrderCount,
        highCancelRateMerchantCount: cancelledGroups.filter(
          (item) => item._count._all >= 3,
        ).length,
        merchantsMissingHomepageCategoryCount: merchantsForHomepageCheck.filter(
          (merchant) => parseHomepageCategoryKeys(merchant.homepageCategoryKeys).length === 0,
        ).length,
      },
      trends: buildTrendRows(last7Start, trendOrders),
      rankings: rankingGroups.map((item) => {
        const merchant = merchantById.get(item.merchantId.toString());
        return {
          merchantId: item.merchantId.toString(),
          merchantName: merchant?.nameZh ?? '',
          city: merchant?.city ?? '',
          district: merchant?.district ?? '',
          businessStatus: merchant?.status ?? MerchantStatus.DELETED,
          orderCount: item._count._all,
          orderAmount: (item._sum.totalAmountVnd ?? 0n).toString(),
        };
      }),
    };
  }
}

function buildTrendRows(
  start: Date,
  orders: Array<{ merchantId: bigint; totalAmountVnd: bigint; createdAt: Date }>,
) {
  const rows = new Map<
    string,
    { date: string; orderCount: number; orderAmount: bigint; merchantIds: Set<string> }
  >();

  for (let index = 0; index < 7; index += 1) {
    const date = formatVietnamDate(addDays(start, index));
    rows.set(date, {
      date,
      orderCount: 0,
      orderAmount: 0n,
      merchantIds: new Set<string>(),
    });
  }

  for (const order of orders) {
    const date = formatVietnamDate(order.createdAt);
    const row = rows.get(date);
    if (!row) continue;
    row.orderCount += 1;
    row.orderAmount += order.totalAmountVnd;
    row.merchantIds.add(order.merchantId.toString());
  }

  return Array.from(rows.values()).map((row) => ({
    date: row.date,
    orderCount: row.orderCount,
    orderAmount: row.orderAmount.toString(),
    activeMerchantCount: row.merchantIds.size,
  }));
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

function formatVietnamDate(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  const year = vietnamTime.getUTCFullYear();
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
