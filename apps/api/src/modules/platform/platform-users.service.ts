import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListPlatformUsersQueryDto } from './dto/list-platform-users-query.dto';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const COMPLETED_STATUSES: OrderStatus[] = [OrderStatus.COMPLETED];
const CANCELLED_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED];

export interface PlatformUserListItem {
  id: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  city: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  orderAmount: string;
  completedOrderCount: number;
  canceledOrderCount: number;
  lastOrderAt: string | null;
}

export interface PlatformUsersListResponse {
  items: PlatformUserListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    userCount: number;
    boundPhoneUserCount: number;
    todayNewUserCount: number;
    orderUserCount: number;
  };
}

export interface PlatformUserDetailResponse {
  user: {
    id: string;
    nickname: string | null;
    phone: string | null;
    avatarUrl: string | null;
    city: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  metrics: {
    orderCount: number;
    orderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    lastOrderAt: string | null;
    averageOrderAmount: string | null;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    merchantId: string;
    merchantName: string;
    orderType: OrderType;
    status: OrderStatus;
    totalAmount: string;
    createdAt: string;
  }>;
}

@Injectable()
export class PlatformUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPlatformUsersQueryDto): Promise<PlatformUsersListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const todayStart = startOfVietnamDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);

    const users = await this.prisma.user.findMany({
      where: this.buildUserWhere(query),
      select: {
        id: true,
        nickname: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const enriched = await this.enrichUsers(users);
    const cityKeyword = query.city?.trim().toLowerCase();
    const filtered = cityKeyword
      ? enriched.filter((item) => (item.city ?? '').toLowerCase().includes(cityKeyword))
      : enriched;

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        userCount: filtered.length,
        boundPhoneUserCount: filtered.filter((item) => Boolean(item.phone?.trim())).length,
        todayNewUserCount: filtered.filter((item) => inVietnamDay(item.createdAt, todayStart, tomorrowStart)).length,
        orderUserCount: filtered.filter((item) => item.orderCount > 0).length,
      },
    };
  }

  async detail(id: bigint): Promise<PlatformUserDetailResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        nickname: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const orders = await this.prisma.order.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        orderNo: true,
        merchantId: true,
        orderType: true,
        status: true,
        totalAmountVnd: true,
        createdAt: true,
        merchant: {
          select: {
            nameZh: true,
            city: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });

    const allOrders = await this.prisma.order.findMany({
      where: { userId: user.id },
      select: {
        status: true,
        totalAmountVnd: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const totalAmount = allOrders.reduce((sum, order) => sum + order.totalAmountVnd, 0n);
    const completedOrderCount = allOrders.filter((order) => order.status === OrderStatus.COMPLETED).length;
    const canceledOrderCount = allOrders.filter((order) => order.status === OrderStatus.CANCELLED).length;
    const recentOrder = allOrders[0] ?? null;

    return {
      user: {
        id: user.id.toString(),
        nickname: user.nickname,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        city: orders[0]?.merchant.city ?? null,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      },
      metrics: {
        orderCount: allOrders.length,
        orderAmount: totalAmount.toString(),
        completedOrderCount,
        canceledOrderCount,
        lastOrderAt: recentOrder?.createdAt.toISOString() ?? null,
        averageOrderAmount:
          allOrders.length > 0 ? (totalAmount / BigInt(allOrders.length)).toString() : null,
      },
      recentOrders: orders.map((order) => ({
        id: order.id.toString(),
        orderNo: order.orderNo,
        merchantId: order.merchantId.toString(),
        merchantName: order.merchant.nameZh,
        orderType: order.orderType,
        status: order.status,
        totalAmount: order.totalAmountVnd.toString(),
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  private buildUserWhere(query: ListPlatformUsersQueryDto): Prisma.UserWhereInput {
    const createdAt = buildDateRange(query.dateFrom, query.dateTo);
    const keyword = query.keyword?.trim();
    const phone = query.phone?.trim();
    const and: Prisma.UserWhereInput[] = [];

    if (createdAt) {
      and.push({ createdAt });
    }
    if (phone) {
      and.push({ phone: { contains: phone } });
    }
    if (keyword) {
      const or: Prisma.UserWhereInput[] = [
        { nickname: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
      if (/^\d+$/.test(keyword)) {
        try {
          or.push({ id: BigInt(keyword) });
        } catch {
          // Ignore oversized numeric keywords and keep partial text matching.
        }
      }
      and.push({ OR: or });
    }

    if (and.length === 0) return {};
    if (and.length === 1) return and[0];
    return { AND: and };
  }

  private async enrichUsers(users: Array<{
    id: bigint;
    nickname: string | null;
    phone: string | null;
    avatarUrl: string | null;
    createdAt: Date;
    lastLoginAt: Date | null;
  }>): Promise<PlatformUserListItem[]> {
    const userIds = users.map((item) => item.id);
    if (userIds.length === 0) {
      return [];
    }

    const [allOrders, completedOrders, cancelledOrders, latestOrders] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
        _max: { createdAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: { in: COMPLETED_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: { in: CANCELLED_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          merchant: {
            select: {
              city: true,
            },
          },
        },
        orderBy: [{ userId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const allMap = new Map<string, (typeof allOrders)[number]>();
    for (const item of allOrders) {
      allMap.set(item.userId.toString(), item);
    }

    const completedMap = new Map<string, number>();
    for (const item of completedOrders) {
      completedMap.set(item.userId.toString(), item._count._all);
    }

    const cancelledMap = new Map<string, number>();
    for (const item of cancelledOrders) {
      cancelledMap.set(item.userId.toString(), item._count._all);
    }

    const cityMap = new Map<string, string | null>();
    for (const order of latestOrders) {
      const key = order.userId.toString();
      if (!cityMap.has(key)) {
        cityMap.set(key, order.merchant.city ?? null);
      }
    }

    return users.map((user) => {
      const key = user.id.toString();
      const orderGroup = allMap.get(key);
      const orderCount = orderGroup?._count._all ?? 0;
      const totalAmount = orderGroup?._sum.totalAmountVnd ?? 0n;
      return {
        id: key,
        nickname: user.nickname,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        city: cityMap.get(key) ?? null,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        orderCount,
        orderAmount: totalAmount.toString(),
        completedOrderCount: completedMap.get(key) ?? 0,
        canceledOrderCount: cancelledMap.get(key) ?? 0,
        lastOrderAt: orderGroup?._max.createdAt?.toISOString() ?? null,
      };
    });
  }

}

function buildDateRange(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (dateFrom) range.gte = startOfVietnamDate(dateFrom);
  if (dateTo) range.lt = addDays(startOfVietnamDate(dateTo), 1);
  return range;
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

function inVietnamDay(value: string, start: Date, end: Date) {
  const time = new Date(value);
  return time >= start && time < end;
}
