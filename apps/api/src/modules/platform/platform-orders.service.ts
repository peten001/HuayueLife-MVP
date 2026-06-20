import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListPlatformOrdersQueryDto } from './dto/list-platform-orders-query.dto';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_ACCEPTANCE,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];

@Injectable()
export class PlatformOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPlatformOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);
    const todayStart = startOfVietnamDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);

    const [items, total, summary] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: this.orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
      this.buildSummary(todayStart, tomorrowStart),
    ]);

    return {
      items: items.map((order) => this.toListItem(order)),
      total,
      page,
      pageSize,
      summary,
    };
  }

  private buildWhere(query: ListPlatformOrdersQueryDto): Prisma.OrderWhereInput {
    const createdAt = buildDateRange(query.dateFrom, query.dateTo);
    const merchantKeyword = query.merchantKeyword?.trim();
    const city = query.city?.trim();
    const phone = query.phone?.trim();
    const orderNo = query.orderNo?.trim();

    return {
      createdAt,
      orderType: query.orderType,
      status: query.status,
      contactPhone: phone ? { contains: phone } : undefined,
      orderNo: orderNo ? { contains: orderNo } : undefined,
      merchant:
        merchantKeyword || city
          ? {
              city: city ? { contains: city } : undefined,
              OR: merchantKeyword
                ? [
                    { nameZh: { contains: merchantKeyword } },
                    { nameVi: { contains: merchantKeyword } },
                    { contactPhone: { contains: merchantKeyword } },
                  ]
                : undefined,
            }
          : undefined,
    };
  }

  private async buildSummary(todayStart: Date, tomorrowStart: Date) {
    const [todayOrderCount, pendingOrderCount, todayOrderAmount, completedCount] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            status: { not: OrderStatus.CANCELLED },
            createdAt: { gte: todayStart, lt: tomorrowStart },
          },
        }),
        this.prisma.order.count({
          where: { status: { in: ACTIVE_ORDER_STATUSES } },
        }),
        this.prisma.order.aggregate({
          where: {
            status: { not: OrderStatus.CANCELLED },
            createdAt: { gte: todayStart, lt: tomorrowStart },
          },
          _sum: { totalAmountVnd: true },
        }),
        this.prisma.order.count({
          where: {
            status: OrderStatus.COMPLETED,
            createdAt: { gte: todayStart, lt: tomorrowStart },
          },
        }),
      ]);

    // completedRate uses completed / non-cancelled orders for today, matching the
    // platform dashboard's non-cancelled order count baseline.
    return {
      todayOrderCount,
      pendingOrderCount,
      completedRate:
        todayOrderCount > 0 ? Math.round((completedCount / todayOrderCount) * 100) : null,
      todayOrderAmount: (todayOrderAmount._sum.totalAmountVnd ?? 0n).toString(),
    };
  }

  private toListItem(order: PlatformOrderWithRelations) {
    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      merchantId: order.merchantId.toString(),
      merchantName: order.merchant.nameZh,
      merchantCity: order.merchant.city,
      merchantDistrict: order.merchant.district,
      orderType: order.orderType,
      status: order.status,
      totalAmount: order.totalAmountVnd.toString(),
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      tableName: order.table?.tableName ?? order.tableNoSnapshot,
      tableNo: order.tableNoSnapshot ?? order.table?.tableNo,
      deliveryAddress: order.deliveryAddress,
      pickupName: order.contactName,
      customerRemark: order.customerRemark,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt.toISOString(),
      completedAt: order.completedAt?.toISOString() ?? null,
      canceledAt: order.cancelledAt?.toISOString() ?? null,
      acceptedAt: order.acceptedAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      items: order.items.map((item) => ({
        id: item.id.toString(),
        productNameZhSnapshot: item.productNameZhSnapshot,
        unitPriceVnd: item.unitPriceVnd.toString(),
        quantity: item.quantity,
        subtotalVnd: item.subtotalVnd.toString(),
        remark: item.remark,
      })),
      statusLogs: order.statusLogs.map((log) => ({
        id: log.id.toString(),
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        operatorType: log.operatorType,
        remark: log.remark,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  private readonly orderInclude = {
    merchant: {
      select: {
        id: true,
        nameZh: true,
        nameVi: true,
        city: true,
        district: true,
      },
    },
    table: {
      select: {
        id: true,
        tableNo: true,
        tableName: true,
      },
    },
    items: {
      orderBy: { id: 'asc' as const },
    },
    statusLogs: {
      orderBy: { createdAt: 'asc' as const },
    },
  };
}

type PlatformOrderWithRelations = Prisma.OrderGetPayload<{
  include: PlatformOrdersService['orderInclude'];
}>;

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
