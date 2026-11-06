import { effectiveOrderWhere } from '../orders/effective-order';
import { BadRequestException, Injectable } from '@nestjs/common';
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
    const days = (range.end.getTime() - range.start.getTime()) / 86400000;
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new BadRequestException('日期范围须为 1 至 366 天');
    const where = this.buildWhere(query, range);
    const previousRange = { start: addDays(range.start, -days), end: range.start };
    const previousOrders = await this.prisma.order.findMany({
      where: effectiveOrderWhere(this.buildWhere(query, previousRange)),
      select: { status: true, totalAmountVnd: true, createdAt: true },
    });
    const [orders] = await Promise.all([
      this.prisma.order.findMany({
        where: effectiveOrderWhere(where),
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
        dateRow.orderAmount += order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n;
      }

      const typeRow = typeStats.get(order.orderType);
      if (typeRow) {
        typeRow.count += 1;
        typeRow.amount += order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n;
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
      merchantRow.orderAmount += order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n;
      merchantStats.set(merchantId, merchantRow);

      const cityKey = order.merchant.city || '-';
      const cityRow = cityStats.get(cityKey) ?? {
        city: cityKey,
        orderCount: 0,
        orderAmount: 0n,
        merchantIds: new Set<string>(),
      };
      cityRow.orderCount += 1;
      cityRow.orderAmount += order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n;
      cityRow.merchantIds.add(merchantId);
      cityStats.set(cityKey, cityRow);
    }

    const orderCount = orders.length;
    const orderAmount = orders.reduce((sum, item) => sum + (item.status === OrderStatus.COMPLETED ? item.totalAmountVnd : 0n), 0n);
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

    const previousTrend = buildDateRangeDates(previousRange.start, previousRange.end).map(date => {
      const rows = previousOrders.filter(order => formatVietnamDate(order.createdAt) === date);
      return { date, orderCount: rows.length, orderAmount: rows.reduce((sum, order) => sum + (order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n), 0n).toString() };
    });
    const hourRows=(rows:Array<{createdAt:Date;status:OrderStatus;totalAmountVnd:bigint}>,start:Date,current=false)=>Array.from({length:24},(_,hour)=>{
      const at=new Date(start.getTime()+hour*3600000);
      const values=rows.filter(row=>row.createdAt>=at&&row.createdAt<new Date(at.getTime()+3600000));
      const future=current&&at>new Date();
      return {date:`${formatVietnamDate(start)}T${String(hour).padStart(2,'0')}:00:00+07:00`,orderCount:future?null:values.length,orderAmount:future?null:values.reduce((sum,row)=>sum+(row.status===OrderStatus.COMPLETED?row.totalAmountVnd:0n),0n).toString()};
    });
    return {
      ...(days===1?{chartTrend:hourRows(orders,range.start,true)}:{}),
      range: { dateFrom: formatVietnamDate(range.start), dateTo: formatVietnamDate(addDays(range.end, -1)), timeZone: 'Asia/Ho_Chi_Minh', includesToday: range.start <= startOfVietnamDay(new Date()) && range.end > startOfVietnamDay(new Date()) },
      previous: { dateFrom: formatVietnamDate(previousRange.start), dateTo: formatVietnamDate(addDays(previousRange.end, -1)), orderCount: previousOrders.length, orderAmount: previousOrders.reduce((sum, order) => sum + (order.status === OrderStatus.COMPLETED ? order.totalAmountVnd : 0n), 0n).toString(), trend: previousTrend, ...(days===1?{chartTrend:hourRows(previousOrders,previousRange.start)}:{}) },
      summary: {
        orderCount,
        orderAmount: orderAmount.toString(),
        completedOrderCount,
        activeOrderAmount: orders.filter(item => ACTIVE_ORDER_STATUSES.includes(item.status)).reduce((sum, item) => sum + item.totalAmountVnd, 0n).toString(),
        canceledOrderAmount: orders.filter(item => item.status === OrderStatus.CANCELLED).reduce((sum, item) => sum + item.totalAmountVnd, 0n).toString(),
        canceledOrderCount,
        pendingOrderCount,
        averageOrderAmount: completedOrderCount > 0 ? (orderAmount / BigInt(completedOrderCount)).toString() : null,
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
