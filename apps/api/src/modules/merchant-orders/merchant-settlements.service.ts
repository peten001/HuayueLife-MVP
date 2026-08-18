import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { addBusinessDays } from '../../common/utils/merchant-hours';
import { normalizeBusinessHours } from '../../common/utils/merchant-hours';
import { resolveBusinessDate } from '../../common/utils/merchant-hours';
import { PrismaService } from '../../database/prisma.service';
import { businessDateRangeCandidateWhere } from './business-day-accounting';
import {
  buildMerchantSettlements,
  compareSettlementsBySettledAtDesc,
  type BusinessDateResolver,
  type MerchantSettlement,
  type SettlementCheckoutLogRow,
  type SettlementOrderRow,
} from './merchant-settlements';
import { ListMerchantSettlementsQueryDto } from './dto/list-merchant-settlements-query.dto';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface MerchantSettlementPage {
  items: MerchantSettlement[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable()
export class MerchantSettlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Merchant-only read model. The canonical builder groups closed table
   * sessions BEFORE search/sort/pagination, so raw Order pagination can never
   * split one settlement across pages.
   */
  async list(
    merchantId: bigint,
    query: ListMerchantSettlementsQueryDto,
  ): Promise<MerchantSettlementPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const schedule = normalizeBusinessHours(
      (
        await this.prisma.merchant.findUnique({
          where: { id: merchantId },
          select: { businessHours: true },
        })
      )?.businessHours,
    );
    const resolver: BusinessDateResolver = (at) => resolveBusinessDate(schedule, at);
    const orders = await this.loadOrders(merchantId, query);
    let settlements = buildMerchantSettlements(orders, resolver);
    if (query.date) {
      settlements = settlements.filter(
        (settlement) => settlement.businessDate === query.date,
      );
    }
    if (query.search?.trim()) {
      const keyword = query.search.trim().toLocaleLowerCase('en-US');
      settlements = settlements.filter(
        (settlement) =>
          settlement.orderNos.some((orderNo) =>
            orderNo.toLocaleLowerCase('en-US').includes(keyword),
          ) ||
          settlement.orderIds.some((orderId) => orderId.includes(keyword)),
      );
    }
    settlements.sort(compareSettlementsBySettledAtDesc);
    const total = settlements.length;
    const start = (page - 1) * pageSize;
    return {
      items: settlements.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  async get(merchantId: bigint, settlementId: string): Promise<MerchantSettlement> {
    const schedule = normalizeBusinessHours(
      (
        await this.prisma.merchant.findUnique({
          where: { id: merchantId },
          select: { businessHours: true },
        })
      )?.businessHours,
    );
    const resolver: BusinessDateResolver = (at) => resolveBusinessDate(schedule, at);
    const orders = await this.loadOrders(merchantId, {
      status: undefined,
      orderType: undefined,
      date: undefined,
      search: undefined,
      page: undefined,
      pageSize: undefined,
    });
    const settlement = buildMerchantSettlements(orders, resolver).find(
      (candidate) => candidate.settlementId === settlementId,
    );
    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }
    return settlement;
  }

  private async loadOrders(
    merchantId: bigint,
    query: ListMerchantSettlementsQueryDto,
  ) {
    const where: Prisma.OrderWhereInput = {
      merchantId,
      status: query.status as OrderStatus | undefined,
      orderType: query.orderType,
    };
    if (query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        throw new BadRequestException('Invalid date');
      }
      where.OR = businessDateRangeCandidateWhere(
        addBusinessDays(query.date, -1),
        addBusinessDays(query.date, 1),
      ).OR;
    }
    const rows = await this.prisma.order.findMany({
      where,
      include: {
        tableSession: {
          select: {
            id: true,
            status: true,
            closedAt: true,
            businessDate: true,
            paymentMethod: true,
            discountAmountVnd: true,
            roundingAmountVnd: true,
          },
        },
        table: {
          select: { id: true, tableNo: true, tableName: true },
        },
        items: {
          select: {
            id: true,
            productId: true,
            productNameZhSnapshot: true,
            imageUrlSnapshot: true,
            unitPriceVnd: true,
            quantity: true,
            subtotalVnd: true,
            remark: true,
            product: {
              select: { nameZh: true, nameVi: true, nameEn: true },
            },
          },
          orderBy: { id: 'asc' as const },
        },
        statusLogs: {
          where: { action: 'TABLE_SESSION_CHECKOUT' },
          select: { metadata: true },
          take: 100,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(
      (order): SettlementOrderRow => ({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        orderType: order.orderType,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
        cancelledAt: order.cancelledAt,
        updatedAt: order.updatedAt,
        businessDate: order.businessDate,
        totalAmountVnd: order.totalAmountVnd,
        itemAmountVnd: order.itemAmountVnd,
        deliveryFeeVnd: order.deliveryFeeVnd,
        discountPayableRateBps: order.discountPayableRateBps,
        discountAmountVnd: order.discountAmountVnd,
        roundingAmountVnd: order.roundingAmountVnd,
        paymentMethod: order.paymentMethod,
        tableId: order.tableId,
        tableSessionId: order.tableSessionId,
        tableNoSnapshot: order.tableNoSnapshot,
        tableSession: order.tableSession,
        table: order.table,
        items: order.items.map((item) => ({
          ...item,
          product: item.product
            ? {
                nameZh: item.product.nameZh,
                nameVi: item.product.nameVi,
                nameEn: item.product.nameEn,
              }
            : null,
        })),
        checkoutLogs: order.statusLogs
          .map((log) => log.metadata as SettlementCheckoutLogRow | null)
          .filter((log): log is SettlementCheckoutLogRow => Boolean(log)),
      }),
    );
  }
}
