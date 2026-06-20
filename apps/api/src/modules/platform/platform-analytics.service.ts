import { Injectable } from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PlatformAnalyticsQueryDto } from './dto/platform-analytics-query.dto';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_ACCEPTANCE,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];
const STATUS_ORDER: OrderStatus[] = [
  OrderStatus.PENDING_ACCEPTANCE,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];
const ORDER_TYPE_ORDER: OrderType[] = [
  OrderType.DINE_IN,
  OrderType.PICKUP,
  OrderType.DELIVERY,
];

@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(query: PlatformAnalyticsQueryDto) {
    const range = resolveDateRange(query.dateFrom, query.dateTo);
    const where = this.buildWhere(query, range);
    const [orders] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          merchantId: true,
          orderType: true,
          status: true,
          totalAmountVnd: true,
          createdAt: true,
          merchant: {
            select: {
              id: true,
              nameZh: true,
              city: true,
              district: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const ordersByDate = new Map<
      string,
      { date: string; orderCount: number; orderAmount: bigint }
    >();
    const typeStats = new Map<OrderType, { count: number; amount: bigint }>();
    const statusStats = new Map<OrderStatus, { count: number; amount: bigint }>();
    const merchantStats = new Map<
      string,
      { merchantId: string; merchantName: string; city: string; orderCount: number; orderAmount: bigint }
    >();
    const cityStats = new Map<
      string,
      { city: string; orderCount: number; orderAmount: bigint; merchantIds: Set<string> }
    >();

    for (const type of ORDER_TYPE_ORDER) {
      typeStats.set(type, { count: 0, amount: 0n });
    }
    for (const status of STATUS_ORDER) {
      statusStats.set(status, { count: 0, amount: 0n });
    }

    for (const day of buildDateRangeDates(range.start, range.end)) {
      ordersByDate.set(day, { date: day, orderCount: 0, orderAmount: 0n });
    }

    for (const order of orders) {
      const date = formatVietnamDate(order.createdAt);
      const dateRow = ordersByDate.get(date);
      if (dateRow) {
        dateRow.orderCount += 1;
        dateRow.orderAmount += order.totalAmountVnd;
      }

      const typeRow = typeStats.get(order.orderType);
      if (typeRow) {
        typeRow.count += 1;
        typeRow.amount += order.totalAmountVnd;
      }

      const statusRow = statusStats.get(order.status);
      if (statusRow) {
        statusRow.count += 1;
        statusRow.amount += order.totalAmountVnd;
      }

      const merchantId = order.merchantId.toString();
      const merchantRow = merchantStats.get(merchantId) ?? {
        merchantId,
        merchantName: order.merchant.nameZh,
        city: order.merchant.city,
        orderCount: 0,
        orderAmount: 0n,
      };
      merchantRow.orderCount += 1;
      merchantRow.orderAmount += order.totalAmountVnd;
      merchantStats.set(merchantId, merchantRow);

      const cityKey = order.merchant.city || '-';
      const cityRow = cityStats.get(cityKey) ?? {
        city: cityKey,
        orderCount: 0,
        orderAmount: 0n,
        merchantIds: new Set<string>(),
      };
      cityRow.orderCount += 1;
      cityRow.orderAmount += order.totalAmountVnd;
      cityRow.merchantIds.add(merchantId);
      cityStats.set(cityKey, cityRow);
    }

    const orderCount = orders.length;
    const orderAmount = orders.reduce((sum, item) => sum + item.totalAmountVnd, 0n);
    const completedOrderCount = orders.filter((item) => item.status === OrderStatus.COMPLETED).length;
    const canceledOrderCount = orders.filter((item) => item.status === OrderStatus.CANCELLED).length;
    const pendingOrderCount = orders.filter((item) => ACTIVE_ORDER_STATUSES.includes(item.status)).length;
    const nonCancelledOrderCount = orderCount - canceledOrderCount;

    const merchantRankingByOrders = Array.from(merchantStats.values())
      .sort((left, right) => right.orderCount - left.orderCount || (right.orderAmount > left.orderAmount ? 1 : right.orderAmount < left.orderAmount ? -1 : 0))
      .slice(0, 5)
      .map((item) => ({
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        city: item.city,
        orderCount: item.orderCount,
        orderAmount: item.orderAmount.toString(),
      }));

    const merchantRankingByAmount = Array.from(merchantStats.values())
      .sort((left, right) => (right.orderAmount > left.orderAmount ? 1 : right.orderAmount < left.orderAmount ? -1 : 0) || right.orderCount - left.orderCount)
      .slice(0, 5)
      .map((item) => ({
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        city: item.city,
        orderCount: item.orderCount,
        orderAmount: item.orderAmount.toString(),
      }));

    return {
      summary: {
        orderCount,
        orderAmount: orderAmount.toString(),
        completedOrderCount,
        canceledOrderCount,
        pendingOrderCount,
        averageOrderAmount: orderCount > 0 ? (orderAmount / BigInt(orderCount)).toString() : null,
        completionRate:
          nonCancelledOrderCount > 0
            ? roundRate((completedOrderCount / nonCancelledOrderCount) * 100)
            : null,
        cancelRate: orderCount > 0 ? roundRate((canceledOrderCount / orderCount) * 100) : null,
      },
      trend: Array.from(ordersByDate.values()).map((item) => ({
        date: item.date,
        orderCount: item.orderCount,
        orderAmount: item.orderAmount.toString(),
      })),
      orderTypeDistribution: ORDER_TYPE_ORDER.map((type) => {
        const stats = typeStats.get(type) ?? { count: 0, amount: 0n };
        return {
          type,
          count: stats.count,
          amount: stats.amount.toString(),
        };
      }),
      statusDistribution: STATUS_ORDER.map((status) => {
        const stats = statusStats.get(status) ?? { count: 0, amount: 0n };
        return {
          status,
          count: stats.count,
          amount: stats.amount.toString(),
        };
      }),
      merchantRankingByOrders,
      merchantRankingByAmount,
      cityStats: Array.from(cityStats.values())
        .map((item) => ({
          city: item.city,
          orderCount: item.orderCount,
          orderAmount: item.orderAmount.toString(),
          merchantCount: item.merchantIds.size,
        }))
        .sort((left, right) => right.orderCount - left.orderCount || (BigInt(right.orderAmount) > BigInt(left.orderAmount) ? 1 : BigInt(right.orderAmount) < BigInt(left.orderAmount) ? -1 : 0)),
    };
  }

  private buildWhere(query: PlatformAnalyticsQueryDto, range: { start: Date; end: Date }): Prisma.OrderWhereInput {
    const merchantId = query.merchantId ? BigInt(query.merchantId) : undefined;
    return {
      createdAt: {
        gte: range.start,
        lt: range.end,
      },
      merchantId,
      merchant: query.city
        ? {
            city: query.city,
          }
        : undefined,
    };
  }
}

function resolveDateRange(dateFrom?: string, dateTo?: string) {
  const todayStart = startOfVietnamDay(new Date());
  const start = dateFrom ? startOfVietnamDate(dateFrom) : addDays(todayStart, -6);
  const end = dateTo ? addDays(startOfVietnamDate(dateTo), 1) : addDays(todayStart, 1);
  return { start, end };
}

function buildDateRangeDates(start: Date, end: Date) {
  const values: string[] = [];
  const current = new Date(start);
  while (current < end) {
    values.push(formatVietnamDate(current));
    current.setTime(current.getTime() + 24 * 60 * 60 * 1000);
  }
  return values;
}

function startOfVietnamDate(value: string) {
  const [year, month, day] = value.split('-').map((item) => Number(item));
  return new Date(Date.UTC(year, month - 1, day) - VIETNAM_OFFSET_MS);
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

function roundRate(value: number) {
  return Math.round(value * 10) / 10;
}
