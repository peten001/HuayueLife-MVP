import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OperatorType,
  OrderStatus,
  OrderType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { ListMerchantOrdersQueryDto } from './dto/list-merchant-orders-query.dto';
import { PrintJobsService } from '../printing/services/print-jobs.service';
import { TableSessionsService } from '../table-sessions/table-sessions.service';
import { OrderCreatorInvariantService } from '../orders/order-creator-invariant.service';
import { PendingOrderCancellationService } from '../orders/pending-order-cancellation.service';
import { CreateTableOrderDto } from './dto/create-table-order.dto';
import { DecreaseOrderItemDto } from './dto/decrease-order-item.dto';
import { ReturnOrderItemDto } from './dto/return-order-item.dto';
import { toMerchantVisibleOrderStatusLog } from '../orders/order-status-log-visibility';
import { withPickupFulfillmentFields } from '../orders/order-fulfillment-fields';
import { withOrderSettlementFields } from '../orders/order-settlement-fields';
import {
  calculateSettlementAdjustment,
  normalizeDiscountPayableRateBps,
} from '../orders/settlement-adjustment';
import {
  assertBusinessDate,
  normalizeBusinessHours,
  resolveBusinessDate,
} from '../../common/utils/merchant-hours';
import {
  attributeOrderRevenue,
  businessDateCandidateWhere,
  businessDateSnapshotValue,
  completedRevenueTotals,
  isOrderInBusinessDate,
} from './business-day-accounting';
import {
  buildMerchantSettlements,
  countSettlementsForBusinessDate,
  type SettlementOrderRow,
} from './merchant-settlements';
import { formatBilingualDishName } from '../printing/types/bilingual-receipt';
import type { PrintBlock } from '../printing/types/print-document';

type MerchantOrderAction =
  | 'ACCEPT'
  | 'REJECT'
  | 'START_PREPARING'
  | 'READY'
  | 'START_DELIVERY'
  | 'COMPLETE';

interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  orderTypes?: OrderType[];
  remark: string;
}

type ItemAdjustmentKind = 'DECREASE' | 'RETURN';

type LockedOrderRow = {
  id: bigint;
  status: OrderStatus;
  order_type: OrderType;
  table_id: bigint | null;
  table_session_id: bigint | null;
  item_amount_vnd: bigint;
  delivery_fee_vnd: bigint;
  total_amount_vnd: bigint;
};

type LockedOrderItemRow = {
  id: bigint;
  order_id: bigint;
  product_id: bigint | null;
  product_name_zh_snapshot: string;
  unit_price_vnd: bigint;
  quantity: number;
  subtotal_vnd: bigint;
};

type LockedProductRow = {
  id: bigint;
  name_zh: string;
  image_url: string | null;
  price_vnd: bigint;
  product_type: string;
  status: string;
  deleted_at: Date | null;
  category_active: number | boolean;
};

const ORDER_ROUNDING_STATUSES: OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
];

const EFFECTIVE_TABLE_ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
]);

const TRANSITIONS: Record<MerchantOrderAction, TransitionRule> = {
  ACCEPT: {
    from: 'PENDING_ACCEPTANCE',
    to: 'ACCEPTED',
    remark: '商家已接单',
  },
  REJECT: {
    from: 'PENDING_ACCEPTANCE',
    to: 'CANCELLED',
    remark: '商家拒绝订单',
  },
  START_PREPARING: {
    from: 'ACCEPTED',
    to: 'PREPARING',
    remark: '商家开始制作',
  },
  READY: {
    from: 'PREPARING',
    to: 'READY',
    remark: '菜品制作完成',
  },
  START_DELIVERY: {
    from: 'READY',
    to: 'DELIVERING',
    orderTypes: ['DELIVERY'],
    remark: '商家开始配送',
  },
  COMPLETE: {
    from: 'READY',
    to: 'COMPLETED',
    orderTypes: ['DINE_IN', 'PICKUP'],
    remark: '订单已完成',
  },
};

@Injectable()
export class MerchantOrdersService {
  private readonly logger = new Logger(MerchantOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly printJobs: PrintJobsService,
    private readonly tableSessions: TableSessionsService,
    private readonly creatorInvariant: OrderCreatorInvariantService,
    private readonly pendingCancellation: PendingOrderCancellationService,
  ) {}

  async list(merchantId: bigint, query: ListMerchantOrdersQueryDto) {
    let dateWhere: Prisma.OrderWhereInput = {};
    let schedule: ReturnType<typeof normalizeBusinessHours> | null = null;
    const requestedDate = query.date;
    if (requestedDate) {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { businessHours: true },
      });
      schedule = normalizeBusinessHours(merchant?.businessHours);
      dateWhere = businessDateCandidateWhere(schedule, requestedDate);
    }
    const orders = await this.prisma.order.findMany({
      where: {
        merchantId,
        status: query.status ?? (query.statuses?.length ? { in: query.statuses } : undefined),
        orderType: query.orderType,
        ...dateWhere,
      },
      include: this.listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const resolvedOrders = requestedDate && schedule
      ? orders.filter((order) => isOrderInBusinessDate(order, schedule, requestedDate))
      : orders;
    return resolvedOrders.map((order) => this.serializeMerchantOrder(order));
  }

  /**
   * Dashboard totals intentionally query the complete filtered set on the
   * server. They never derive monetary figures from the paged/displayed rows.
   */
  async summary(merchantId: bigint, query: ListMerchantOrdersQueryDto) {
    let dateWhere: Prisma.OrderWhereInput = {};
    let schedule: ReturnType<typeof normalizeBusinessHours> | null = null;
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { businessHours: true },
    });
    const requestedDate = query.date;
    if (requestedDate) {
      schedule = normalizeBusinessHours(merchant?.businessHours);
      dateWhere = businessDateCandidateWhere(schedule, requestedDate);
    }
    const orders = await this.prisma.order.findMany({
      where: {
        merchantId,
        status: query.status ?? (query.statuses?.length ? { in: query.statuses } : undefined),
        orderType: query.orderType,
        ...dateWhere,
      },
      select: {
        id: true,
        status: true,
        orderType: true,
        totalAmountVnd: true,
        discountPayableRateBps: true,
        discountAmountVnd: true,
        roundingAmountVnd: true,
        paymentMethod: true,
        tableSessionId: true,
        createdAt: true,
        businessDate: true,
        tableSession: {
          select: {
            id: true,
            status: true,
            closedAt: true,
            businessDate: true,
            discountAmountVnd: true,
            roundingAmountVnd: true,
            paymentMethod: true,
          },
        },
        table: {
          select: { id: true, tableNo: true, tableName: true },
        },
        orderNo: true,
        completedAt: true,
        cancelledAt: true,
        updatedAt: true,
        itemAmountVnd: true,
        deliveryFeeVnd: true,
        tableId: true,
        tableNoSnapshot: true,
        printLogs: { select: { status: true } },
      },
    });
    const resolvedOrders = requestedDate && schedule
      ? orders.filter((order) => isOrderInBusinessDate(order, schedule, requestedDate))
      : orders;
    const buckets = {
      ALL: { count: 0, amountVnd: 0n },
      DINE_IN: { count: 0, amountVnd: 0n },
      PICKUP: { count: 0, amountVnd: 0n },
      DELIVERY: { count: 0, amountVnd: 0n },
      ABNORMAL: { count: 0, amountVnd: 0n },
    };
    const statusBreakdown = new Map<string, number>();
    const completedOrders: Array<(typeof resolvedOrders)[number]> = [];
    const staleBefore = Date.now() - 20 * 60 * 1000;
    for (const order of resolvedOrders) {
      const amount = order.status === 'CANCELLED' ? 0n : order.totalAmountVnd;
      buckets.ALL.count += 1;
      buckets.ALL.amountVnd += amount;
      statusBreakdown.set(order.status, (statusBreakdown.get(order.status) ?? 0) + 1);
      const typeBucket = buckets[order.orderType];
      typeBucket.count += 1;
      typeBucket.amountVnd += amount;
      const abnormal =
        (order.status === 'PENDING_ACCEPTANCE' && order.createdAt.getTime() < staleBefore) ||
        order.printLogs.some((log) => log.status === 'FAILED');
      if (abnormal) {
        buckets.ABNORMAL.count += 1;
        buckets.ABNORMAL.amountVnd += amount;
      }
      if (order.status === 'COMPLETED') completedOrders.push(order);
    }
    // Session-level discount/rounding is attributed across the full completed
    // session (which may span two business dates), then summed only for the
    // orders of this business date - identical to businessDaySummary.
    const completedSuperset = orders.filter((order) => order.status === 'COMPLETED');
    const attribution = attributeOrderRevenue(completedSuperset);
    const totals = completedRevenueTotals(completedOrders, attribution);
    const resolvedSchedule = schedule ?? normalizeBusinessHours(merchant?.businessHours);
    const settlementRows = completedOrders.map(toSettlementRow);
    const settlementCount = requestedDate
      ? countSettlementsForBusinessDate(
          settlementRows,
          requestedDate,
          (at) => resolveBusinessDate(resolvedSchedule, at),
        )
      : buildMerchantSettlements(
          settlementRows,
          (at) => resolveBusinessDate(resolvedSchedule, at),
        ).length;
    return {
      ALL: { count: buckets.ALL.count, amountVnd: buckets.ALL.amountVnd.toString() },
      DINE_IN: { count: buckets.DINE_IN.count, amountVnd: buckets.DINE_IN.amountVnd.toString() },
      PICKUP: { count: buckets.PICKUP.count, amountVnd: buckets.PICKUP.amountVnd.toString() },
      DELIVERY: { count: buckets.DELIVERY.count, amountVnd: buckets.DELIVERY.amountVnd.toString() },
      ABNORMAL: { count: buckets.ABNORMAL.count, amountVnd: buckets.ABNORMAL.amountVnd.toString() },
      COMPLETED: {
        count: totals.orderCount,
        settlementCount,
        amountVnd: totals.netSettledAmountVnd.toString(),
        grossAmountVnd: totals.grossAmountVnd.toString(),
        discountAmountVnd: totals.discountAmountVnd.toString(),
        roundingAmountVnd: totals.roundingAmountVnd.toString(),
        cashRevenueVnd: totals.cashRevenueVnd.toString(),
        bankTransferRevenueVnd: totals.bankTransferRevenueVnd.toString(),
        unrecordedRevenueVnd: totals.unrecordedRevenueVnd.toString(),
      },
      statusBreakdown: Object.fromEntries(
        [...statusBreakdown.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    };
  }

  async get(merchantId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, merchantId },
      include: this.detailInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.serializeMerchantOrder(order);
  }

  async createTableOrder(
    merchantId: bigint,
    staffId: bigint,
    tableId: bigint,
    dto: CreateTableOrderDto,
  ) {
    const normalizedItems = this.normalizeCreateItems(dto);
    let result: { orderId: bigint | null; sessionId: bigint; printTriggerIds: bigint[] };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const creator = await this.creatorInvariant.assertValid(tx, {
          merchantId,
          userId: null,
          createdByStaffId: staffId,
        });
        const merchant = await tx.merchant.findUnique({
          where: { id: merchantId },
          select: { businessHours: true },
        });

        const duplicate = await tx.order.findUnique({
          where: {
            merchantId_createdByStaffId_idempotencyKey: {
              merchantId,
              createdByStaffId: staffId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          select: {
            id: true,
            tableId: true,
            tableSessionId: true,
            statusLogs: {
              where: {
                action: 'MERCHANT_ADD_ITEMS',
                requestKey: dto.idempotencyKey,
              },
              select: { metadata: true },
              take: 1,
            },
          },
        });
        if (duplicate) {
          if (
            duplicate.tableId !== tableId ||
            !duplicate.tableSessionId ||
            !this.metadataMatchesAddOrder(
              duplicate.statusLogs[0]?.metadata ?? null,
              normalizedItems,
            )
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: '点菜请求标识已用于其他桌台',
            });
          }
          return { orderId: duplicate.id, sessionId: duplicate.tableSessionId, printTriggerIds: [] };
        }

        const tableRows = await tx.$queryRaw<
          Array<{
            id: bigint;
            table_no: string;
            table_name: string | null;
            status: string;
          }>
        >`
          SELECT id, table_no, table_name, status
          FROM dining_tables
          WHERE id = ${tableId} AND merchant_id = ${merchantId}
          FOR UPDATE
        `;
        const table = tableRows[0];
        if (!table) {
          throw new NotFoundException({
            code: 'TABLE_NOT_FOUND',
            message: '桌台不存在',
          });
        }
        if (table.status !== 'ACTIVE') {
          throw new ConflictException({
            code: 'TABLE_NOT_AVAILABLE',
          message: '桌台当前不可用',
        });
        }

        const session = await this.tableSessions.getOrCreateOpenSession(
          tx,
          merchantId,
          tableId,
        );

        if (normalizedItems.length === 0) {
          if (!session.created) {
            throw new ConflictException({
              code: 'TABLE_ALREADY_OPEN',
              message: '桌台已由其他人员开台，请刷新后继续点菜',
            });
          }
          return { orderId: null, sessionId: session.id, printTriggerIds: [] };
        }

        const productIds = [
          ...new Set(normalizedItems.map(({ productId }) => productId)),
        ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const products = await tx.$queryRaw<LockedProductRow[]>(Prisma.sql`
          SELECT p.id, p.name_zh, p.image_url, p.price_vnd,
                 p.product_type, p.status, p.deleted_at, c.is_active AS category_active
          FROM products p
          INNER JOIN categories c ON c.id = p.category_id
          WHERE p.merchant_id = ${merchantId}
            AND p.id IN (${Prisma.join(productIds)})
          ORDER BY p.id
          FOR SHARE
        `);
        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );
        const pricedItems = normalizedItems.map((item) => {
          const product = productsById.get(item.productId);
          if (
            !product ||
            product.product_type !== 'FOOD' ||
            product.status !== 'ON_SALE' ||
            product.deleted_at != null ||
            !Boolean(product.category_active)
          ) {
            throw new ConflictException({
              code: 'PRODUCT_NOT_AVAILABLE',
              message: '菜品已下架、售罄或不属于当前商家',
            });
          }
          const subtotalVnd = product.price_vnd * BigInt(item.quantity);
          return { ...item, product, subtotalVnd };
        });
        const itemAmountVnd = pricedItems.reduce(
          (sum, item) => sum + item.subtotalVnd,
          0n,
        );

        const createdAt = new Date();
        const created = await tx.order.create({
          data: {
            orderNo: this.generateOrderNo(),
            idempotencyKey: dto.idempotencyKey,
            userId: null,
            createdByStaffId: staffId,
            merchantId,
            tableId,
            tableSessionId: session.id,
            tableNoSnapshot: table.table_no,
            orderType: 'DINE_IN',
            itemAmountVnd,
            deliveryFeeVnd: 0n,
            totalAmountVnd: itemAmountVnd,
            businessDate: businessDateSnapshotValue(merchant?.businessHours ?? null, createdAt),
            createdAt,
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            items: {
              create: pricedItems.map((item) => ({
                productId: item.product.id,
                productNameZhSnapshot: item.product.name_zh,
                imageUrlSnapshot: item.product.image_url,
                unitPriceVnd: item.product.price_vnd,
                quantity: item.quantity,
                subtotalVnd: item.subtotalVnd,
                remark: item.remark || undefined,
              })),
            },
            statusLogs: {
              create: [
                {
                  fromStatus: null,
                  toStatus: 'ACCEPTED',
                  operatorType: OperatorType.MERCHANT_STAFF,
                  operatorStaffId: staffId,
                  action: 'MERCHANT_ADD_ITEMS',
                  requestKey: dto.idempotencyKey,
                  metadata: {
                    actorId: staffId.toString(),
                    actorRole: creator.staffRole,
                    tableId: tableId.toString(),
                    tableSessionId: session.id.toString(),
                    itemAmountVnd: itemAmountVnd.toString(),
                    items: pricedItems.map((item) => ({
                      productId: item.product.id.toString(),
                      productNameSnapshot: item.product.name_zh,
                      quantity: item.quantity,
                      remark: item.remark ?? null,
                      unitPriceVnd: item.product.price_vnd.toString(),
                      subtotalVnd: item.subtotalVnd.toString(),
                    })),
                  },
                  remark: '商家点菜创建追加订单并自动接单',
                },
              ],
            },
          },
          select: {
            id: true,
            tableSessionId: true,
            statusLogs: {
              where: { action: 'MERCHANT_ADD_ITEMS', requestKey: dto.idempotencyKey },
              select: { id: true },
              take: 1,
            },
          },
        });
        const printTriggers = await this.printJobs.enqueueAutomaticTriggersForOrderTransition(tx, {
          merchantId,
          orderId: created.id,
          orderStatusLogId: created.statusLogs[0].id,
          orderType: 'DINE_IN',
          status: 'ACCEPTED',
        });
        // Any order mutation invalidates the current settlement adjustment.
        // Clear it atomically so refresh/checkout/printing cannot reuse a
        // discount or rounding amount calculated from an older bill total.
        await this.clearSessionAdjustment(tx, session.id);
        return {
          orderId: created.id,
          sessionId: created.tableSessionId!,
          printTriggerIds: printTriggers.map(({ id: triggerId }) => triggerId),
        };
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const duplicate = await this.prisma.order.findUnique({
        where: {
          merchantId_createdByStaffId_idempotencyKey: {
            merchantId,
            createdByStaffId: staffId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: {
          id: true,
          tableId: true,
          tableSessionId: true,
          statusLogs: {
            where: {
              action: 'MERCHANT_ADD_ITEMS',
              requestKey: dto.idempotencyKey,
            },
            select: { metadata: true },
            take: 1,
          },
        },
      });
      if (!duplicate) {
        throw error;
      }
      if (
        !duplicate.tableSessionId ||
        duplicate.tableId !== tableId ||
        !this.metadataMatchesAddOrder(
          duplicate.statusLogs[0]?.metadata ?? null,
          normalizedItems,
        )
      ) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: '点菜请求标识已用于其他请求',
        });
      }
      result = { orderId: duplicate.id, sessionId: duplicate.tableSessionId, printTriggerIds: [] };
    }

    if (result.printTriggerIds.length > 0) {
      try {
        await this.printJobs.processAutomaticTriggerIds(result.printTriggerIds);
      } catch (error) {
        this.logger.warn(
          `Print trigger processing deferred merchant=${merchantId} order=${result.orderId} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }

    return this.buildMutationResponse(merchantId, result.orderId, result.sessionId);
  }

  decreaseOrderItem(
    merchantId: bigint,
    staffId: bigint,
    orderId: bigint,
    itemId: bigint,
    dto: DecreaseOrderItemDto,
  ) {
    if (dto.targetQuantity >= dto.expectedQuantity) {
      throw new BadRequestException({
        code: 'INVALID_ITEM_QUANTITY',
        message: '减菜后的数量必须小于当前数量',
      });
    }
    return this.adjustOrderItem(merchantId, staffId, orderId, itemId, {
      kind: 'DECREASE',
      requestKey: dto.requestKey,
      expectedQuantity: dto.expectedQuantity,
      targetQuantity: dto.targetQuantity,
    });
  }

  returnOrderItem(
    merchantId: bigint,
    staffId: bigint,
    orderId: bigint,
    itemId: bigint,
    dto: ReturnOrderItemDto,
  ) {
    if (dto.returnQuantity > dto.expectedQuantity) {
      throw new BadRequestException({
        code: 'INVALID_ITEM_QUANTITY',
        message: '退菜数量不能超过当前数量',
      });
    }
    return this.adjustOrderItem(merchantId, staffId, orderId, itemId, {
      kind: 'RETURN',
      requestKey: dto.requestKey,
      expectedQuantity: dto.expectedQuantity,
      targetQuantity: dto.expectedQuantity - dto.returnQuantity,
    });
  }

  async transition(
    merchantId: bigint,
    staffId: bigint,
    id: bigint,
    action: MerchantOrderAction,
    reason?: string,
    paymentMethod?: PaymentMethod,
  ) {
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, merchantId },
        select: {
          id: true,
          status: true,
          orderType: true,
          createdAt: true,
          businessDate: true,
          merchant: { select: { businessHours: true } },
        },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const rule = this.resolveRule(action, order.orderType, order.status);
      if (order.status !== rule.from) {
        throw new ConflictException(
          `订单当前状态为 ${order.status}，不能执行此操作`,
        );
      }
      if (rule.orderTypes && !rule.orderTypes.includes(order.orderType)) {
        throw new ConflictException('当前订单类型不允许执行此操作');
      }

      const now = new Date();
      const data: Prisma.OrderUpdateManyMutationInput = {
        status: rule.to,
        acceptedAt: rule.to === 'ACCEPTED' ? now : undefined,
        readyAt: rule.to === 'READY' ? now : undefined,
        completedAt: rule.to === 'COMPLETED' ? now : undefined,
        // Business Date is the order's business-ownership date, snapshotted at
        // creation. Completion never overwrites it; legacy orders are filled
        // with the canonical creation-time resolver so cross-midnight orders
        // stay on the business date that contained their creation.
        businessDate:
          rule.to === 'COMPLETED' && !order.businessDate
            ? businessDateSnapshotValue(order.merchant.businessHours, order.createdAt)
            : undefined,
        paymentMethod: rule.to === 'COMPLETED' ? paymentMethod : undefined,
        cancelledAt: rule.to === 'CANCELLED' ? now : undefined,
        cancelReason:
          rule.to === 'CANCELLED'
            ? reason?.trim() || '商家拒绝订单'
            : undefined,
      };
      const updated = await tx.order.updateMany({
        where: { id, merchantId, status: rule.from },
        data,
      });
      if (updated.count !== 1) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }

      const statusLog = await tx.orderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: rule.from,
          toStatus: rule.to,
          operatorType: OperatorType.MERCHANT_STAFF,
          operatorStaffId: staffId,
          remark:
            rule.to === 'CANCELLED' && reason?.trim()
              ? `${rule.remark}：${reason.trim()}`
              : rule.remark,
        },
      });
      const printTriggers =
        rule.to === 'ACCEPTED' || rule.to === 'COMPLETED'
          ? await this.printJobs.enqueueAutomaticTriggersForOrderTransition(tx, {
              merchantId,
              orderId: id,
              orderStatusLogId: statusLog.id,
              orderType: order.orderType,
              status: rule.to,
            })
          : [];

      return {
        order: await this.requireOrder(tx, merchantId, id),
        printTriggerIds: printTriggers.map(({ id: triggerId }) => triggerId),
      };
    });
    if (transitioned.printTriggerIds.length > 0) {
      try {
        await this.printJobs.processAutomaticTriggerIds(transitioned.printTriggerIds);
      } catch (error) {
        // The trigger intent is already durable in the transaction above.
        // Connector claim performs compensation if this immediate attempt is
        // interrupted or temporarily fails.
        this.logger.warn(
          `Print trigger processing deferred merchant=${merchantId} order=${id} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }
    return this.serializeMerchantOrder(transitioned.order);
  }

  async businessDaySummary(merchantId: bigint, requestedBusinessDate?: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, nameZh: true, nameVi: true, businessHours: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const businessDate = requestedBusinessDate ?? resolveBusinessDate(merchant.businessHours);
    try {
      assertBusinessDate(businessDate);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid businessDate');
    }

    const schedule = normalizeBusinessHours(merchant.businessHours);
    const candidates = await this.prisma.order.findMany({
      where: {
        merchantId,
        status: 'COMPLETED',
        ...businessDateCandidateWhere(schedule, businessDate),
      },
      include: {
        table: {
          select: { id: true, tableNo: true, tableName: true },
        },
        items: {
          select: {
            productNameZhSnapshot: true,
            quantity: true,
            product: {
              select: {
                nameVi: true,
                nameEn: true,
              },
            },
          },
        },
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
      },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    });
    const orders = candidates.filter((order) =>
      isOrderInBusinessDate(order, schedule, businessDate),
    );

    const itemMap = new Map<string, {
      nameZh: string;
      nameVi: string | null;
      nameEn: string | null;
      quantity: number;
    }>();
    for (const order of orders) {
      for (const item of order.items) {
        const nameVi = item.product?.nameVi ?? null;
        const nameEn = item.product?.nameEn ?? null;
        const key = [item.productNameZhSnapshot, nameVi, nameEn].join('\u0000');
        const current = itemMap.get(key);
        if (current) current.quantity += item.quantity;
        else itemMap.set(key, {
          nameZh: item.productNameZhSnapshot,
          nameVi,
          nameEn,
          quantity: item.quantity,
        });
      }
    }

    const attribution = attributeOrderRevenue(candidates);
    const totals = completedRevenueTotals(orders, attribution);
    const settlementCount = countSettlementsForBusinessDate(
      candidates.map(toSettlementRow),
      businessDate,
      (at) => resolveBusinessDate(schedule, at),
    );

    return {
      merchant: { id: merchant.id, nameZh: merchant.nameZh, nameVi: merchant.nameVi },
      businessDate,
      segments: schedule[weekdayKey(businessDate)].map((range) => {
        const [start, end] = range.split('-');
        return { start, end, crossesMidnight: minutesOfDay(end) < minutesOfDay(start) };
      }),
      orderCount: orders.length,
      settlementCount,
      itemSummary: [...itemMap.values()].sort((left, right) =>
        right.quantity - left.quantity || left.nameZh.localeCompare(right.nameZh, 'zh-Hans-CN')),
      discountAmountVnd: totals.discountAmountVnd.toString(),
      roundingAmountVnd: totals.roundingAmountVnd.toString(),
      totalRevenueVnd: totals.netSettledAmountVnd.toString(),
      cashRevenueVnd: totals.cashRevenueVnd.toString(),
      bankTransferRevenueVnd: totals.bankTransferRevenueVnd.toString(),
      unrecordedRevenueVnd: totals.unrecordedRevenueVnd.toString(),
      generatedAt: new Date().toISOString(),
    };
  }

  async printBusinessDaySummary(
    merchantId: bigint,
    staffId: bigint,
    businessDate: string,
    requestKey: string,
    requestId?: string,
    printerId?: bigint,
  ) {
    const summary = await this.businessDaySummary(merchantId, businessDate);
    const money = (value: string) => `${new Intl.NumberFormat('vi-VN').format(Number(value))} VND`;
    const blocks: PrintBlock[] = [
      textBlock(summary.merchant.nameZh, true, 'LARGE', 'CENTER'),
      { type: 'DIVIDER' },
      textBlock(`营业日 / Ngày kinh doanh: ${summary.businessDate}`, true),
      textBlock('营业时段 / Giờ kinh doanh', true),
      ...summary.segments.map((segment) => textBlock(
        `${segment.start}-${segment.crossesMidnight ? '次日/' : ''}${segment.end}`,
        false,
      )),
      { type: 'ROW', left: '已完成订单 / Đơn hoàn tất', right: String(summary.orderCount), bold: true },
      ...buildTopItemsBlocks(summary.itemSummary),
      { type: 'ROW', left: '折扣 / Giảm giá', right: money(summary.discountAmountVnd), bold: false },
      { type: 'ROW', left: '抹零 / Làm tròn', right: money(summary.roundingAmountVnd), bold: false },
      { type: 'ROW', left: '总收入 / Doanh thu', right: money(summary.totalRevenueVnd), bold: true },
      { type: 'ROW', left: '现金 / Tiền mặt', right: money(summary.cashRevenueVnd), bold: false },
      { type: 'ROW', left: '银行转账 / Chuyển khoản', right: money(summary.bankTransferRevenueVnd), bold: false },
      ...(summary.unrecordedRevenueVnd !== '0'
        ? [{ type: 'ROW' as const, left: '历史未记录 / Chưa ghi nhận', right: money(summary.unrecordedRevenueVnd), bold: false }]
        : []),
    ];
    const job = await this.printJobs.createBusinessSummaryPrintJob({
      merchantId,
      createdByStaffId: staffId,
      requestId,
      requestKey,
      businessDate,
      printerId,
      blocks,
    });
    return { job, summary };
  }

  private async adjustOrderItem(
    merchantId: bigint,
    staffId: bigint,
    orderId: bigint,
    itemId: bigint,
    input: {
      kind: ItemAdjustmentKind;
      requestKey: string;
      expectedQuantity: number;
      targetQuantity: number;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const creator = await this.creatorInvariant.assertValid(tx, {
        merchantId,
        userId: null,
        createdByStaffId: staffId,
      });
      const orderRef = await tx.order.findFirst({
        where: { id: orderId, merchantId },
        select: {
          id: true,
          tableId: true,
          tableSessionId: true,
          orderType: true,
        },
      });
      if (!orderRef) {
        throw new NotFoundException({
          code: 'ORDER_NOT_FOUND',
          message: '订单不存在',
        });
      }
      if (orderRef.orderType !== 'DINE_IN' || !orderRef.tableSessionId) {
        throw new ConflictException({
          code: 'ORDER_NOT_IN_TABLE_SESSION',
          message: '只有用餐中桌台订单可以调整菜品',
        });
      }
      if (!orderRef.tableId) {
        throw new ConflictException({
          code: 'ORDER_TABLE_SESSION_MISMATCH',
          message: '订单与桌账关联不一致，不能调整菜品',
        });
      }

      const expectedAction =
        input.kind === 'DECREASE'
          ? 'ORDER_ITEM_DECREASED'
          : 'ORDER_ITEM_RETURNED';
      // Keep the same lock order used by table opening and checkout. The table
      // lock prevents a concurrent add-on order from entering the session
      // while this transaction decides whether the table has become empty.
      const tableRows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id
        FROM dining_tables
        WHERE id = ${orderRef.tableId} AND merchant_id = ${merchantId}
        FOR UPDATE
      `;
      if (!tableRows[0]) {
        throw new NotFoundException({
          code: 'TABLE_NOT_FOUND',
          message: '桌台不存在',
        });
      }
      const sessionRows = await tx.$queryRaw<
        Array<{
          id: bigint;
          table_id: bigint;
          status: string;
          open_table_id: bigint | null;
        }>
      >`
        SELECT id, table_id, status, open_table_id
        FROM table_sessions
        WHERE id = ${orderRef.tableSessionId}
          AND merchant_id = ${merchantId}
        FOR UPDATE
      `;
      const session = sessionRows[0];
      if (!session) {
        throw new ConflictException({
          code: 'TABLE_SESSION_CLOSED',
          message: '桌账已关闭，不能操作',
        });
      }

      // Lock every order in deterministic order so the whole-session effective
      // quantity below is a current, transactionally stable value.
      const orderRows = await tx.$queryRaw<LockedOrderRow[]>`
        SELECT id, status, order_type, table_id, table_session_id,
               item_amount_vnd, delivery_fee_vnd, total_amount_vnd
        FROM orders
        WHERE table_session_id = ${orderRef.tableSessionId}
          AND merchant_id = ${merchantId}
        ORDER BY id
        FOR UPDATE
      `;
      const order = orderRows.find(({ id }) => id === orderId);
      if (
        !order ||
        order.table_session_id !== orderRef.tableSessionId ||
        order.table_id !== session.table_id
      ) {
        throw new ConflictException({
          code: 'ORDER_TABLE_SESSION_MISMATCH',
          message: '订单与桌账关联不一致，不能调整菜品',
        });
      }
      // Lookup after acquiring the order lock so a concurrent retry observes
      // the first transaction's committed request log under MySQL RR.
      const priorRequestRows = await tx.$queryRaw<
        Array<{ action: string | null; metadata: Prisma.JsonValue | string }>
      >`
        SELECT action, metadata
        FROM order_status_logs
        WHERE order_id = ${orderId} AND request_key = ${input.requestKey}
        LIMIT 1
        FOR UPDATE
      `;
      const priorRequest = priorRequestRows[0];
      if (priorRequest) {
        if (
          priorRequest.action !== expectedAction ||
          !this.metadataMatchesAdjustment(
            this.parseJsonValue(priorRequest.metadata),
            {
              itemId,
              staffId,
              kind: input.kind,
              expectedQuantity: input.expectedQuantity,
              targetQuantity: input.targetQuantity,
            },
          )
        ) {
          throw new ConflictException({
            code: 'ADJUSTMENT_REQUEST_KEY_CONFLICT',
            message: '请求标识已用于其他菜品操作',
          });
        }
        return { orderId, sessionId: orderRef.tableSessionId };
      }
      if (session.status !== 'OPEN' || session.open_table_id === null) {
        throw new ConflictException({
          code: 'TABLE_SESSION_CLOSED',
          message: '桌账已关闭，不能操作',
        });
      }
      const allowedStatuses: OrderStatus[] =
        input.kind === 'DECREASE'
          ? ['PENDING_ACCEPTANCE']
          : ['ACCEPTED', 'PREPARING', 'READY'];
      if (!allowedStatuses.includes(order.status)) {
        throw new ConflictException({
          code: 'ORDER_STATUS_CHANGED',
          message: '订单状态已变化，请刷新后重试',
        });
      }
      if (input.kind === 'RETURN' && order.order_type !== 'DINE_IN') {
        throw new ConflictException({
          code: 'ORDER_STATUS_CHANGED',
          message: '当前订单不允许退菜',
        });
      }

      // Lock every item in the session, not only the target order. This avoids
      // stale aggregate reads after a concurrent request waited on the table
      // lock under MySQL REPEATABLE READ.
      const itemRows = await tx.$queryRaw<LockedOrderItemRow[]>`
        SELECT oi.id, oi.order_id, oi.product_id,
               oi.product_name_zh_snapshot, oi.unit_price_vnd,
               oi.quantity, oi.subtotal_vnd
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.table_session_id = ${orderRef.tableSessionId}
          AND o.merchant_id = ${merchantId}
        ORDER BY oi.order_id, oi.id
        FOR UPDATE
      `;
      const item = itemRows.find(({ id }) => id === itemId);
      if (!item || item.order_id !== orderId) {
        throw new NotFoundException({
          code: 'ORDER_ITEM_NOT_FOUND',
          message: '订单菜品不存在',
        });
      }
      if (item.quantity !== input.expectedQuantity) {
        throw new ConflictException({
          code: 'ORDER_ITEM_QUANTITY_CHANGED',
          message: '菜品数量已变化，请刷新后重试',
        });
      }
      if (
        input.targetQuantity < 0 ||
        input.targetQuantity >= item.quantity
      ) {
        throw new BadRequestException({
          code: 'INVALID_ITEM_QUANTITY',
          message: '菜品调整数量无效',
        });
      }

      const orderItemRows = itemRows.filter(
        ({ order_id: currentOrderId }) => currentOrderId === orderId,
      );

      const afterItemAmountVnd =
        item.unit_price_vnd * BigInt(input.targetQuantity);
      if (input.targetQuantity === 0) {
        await tx.orderItem.delete({ where: { id: itemId } });
      } else {
        await tx.orderItem.update({
          where: { id: itemId },
          data: {
            quantity: input.targetQuantity,
            subtotalVnd: afterItemAmountVnd,
          },
        });
      }

      const afterOrderItemAmountVnd = orderItemRows.reduce((sum, current) => {
        if (current.id === itemId) {
          return sum + afterItemAmountVnd;
        }
        return sum + current.subtotal_vnd;
      }, 0n);
      const afterOrderAmountVnd =
        afterOrderItemAmountVnd + order.delivery_fee_vnd;
      const cancelEmptyOrder = orderItemRows.every((current) =>
        current.id === itemId ? input.targetQuantity === 0 : current.quantity === 0,
      );
      const ordersById = new Map(orderRows.map((current) => [current.id, current]));
      const effectiveQuantityAfterAdjustment = itemRows.reduce((sum, current) => {
        const currentOrder = ordersById.get(current.order_id);
        if (!currentOrder || !EFFECTIVE_TABLE_ORDER_STATUSES.has(currentOrder.status)) {
          return sum;
        }
        return sum + (current.id === itemId ? input.targetQuantity : current.quantity);
      }, 0);
      const closeEmptySession =
        input.kind === 'RETURN' &&
        cancelEmptyOrder &&
        effectiveQuantityAfterAdjustment === 0;

      if (!cancelEmptyOrder) {
        const updated = await tx.order.updateMany({
          where: {
            id: orderId,
            merchantId,
            status: order.status,
            tableSessionId: orderRef.tableSessionId,
          },
          data: {
            itemAmountVnd: afterOrderItemAmountVnd,
            totalAmountVnd: afterOrderAmountVnd,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: 'ORDER_STATUS_CHANGED',
            message: '订单状态已变化，请刷新后重试',
          });
        }
      }

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: order.status,
          operatorType: OperatorType.MERCHANT_STAFF,
          operatorStaffId: staffId,
          action: expectedAction,
          requestKey: input.requestKey,
          metadata: {
            orderItemId: itemId.toString(),
            productId: item.product_id?.toString() ?? null,
            productNameSnapshot: item.product_name_zh_snapshot,
            beforeQuantity: item.quantity,
            afterQuantity: input.targetQuantity,
            delta: input.targetQuantity - item.quantity,
            ...(input.kind === 'RETURN'
              ? { returnedQuantity: item.quantity - input.targetQuantity }
              : { decreasedQuantity: item.quantity - input.targetQuantity }),
            unitPriceVnd: item.unit_price_vnd.toString(),
            beforeItemAmountVnd: item.subtotal_vnd.toString(),
            afterItemAmountVnd: afterItemAmountVnd.toString(),
            beforeOrderAmountVnd: order.total_amount_vnd.toString(),
            afterOrderAmountVnd: afterOrderAmountVnd.toString(),
            orderAutoCancelled: cancelEmptyOrder,
            tableSessionAutoClosed: closeEmptySession,
            tableReleased: closeEmptySession,
            merchantId: merchantId.toString(),
            orderId: orderId.toString(),
            tableSessionId: orderRef.tableSessionId.toString(),
            tableId: orderRef.tableId.toString(),
            actorId: staffId.toString(),
            actorRole: creator.staffRole,
          },
          remark:
            input.kind === 'DECREASE' ? '商家减少未接单菜品' : '商家退菜',
        },
      });

      if (cancelEmptyOrder) {
        if (input.kind === 'DECREASE') {
          await this.pendingCancellation.cancel(tx, {
            orderId,
            merchantId,
            operatorStaffId: staffId,
            reason: '商家将未接单订单全部减为零，订单已取消',
            itemAmountVnd: afterOrderItemAmountVnd,
            totalAmountVnd: afterOrderAmountVnd,
          });
        } else {
          const cancelledAt = new Date();
          const cancelled = await tx.order.updateMany({
            where: {
              id: orderId,
              merchantId,
              status: order.status,
              tableSessionId: orderRef.tableSessionId,
            },
            data: {
              status: 'CANCELLED',
              cancelledAt,
              cancelReason: '商家退空订单全部菜品，订单已自动取消',
              itemAmountVnd: afterOrderItemAmountVnd,
              totalAmountVnd: afterOrderAmountVnd,
            },
          });
          if (cancelled.count !== 1) {
            throw new ConflictException({
              code: 'ORDER_STATUS_CHANGED',
              message: '订单状态已变化，请刷新后重试',
            });
          }

          if (closeEmptySession) {
            const closed = await tx.tableSession.updateMany({
              where: {
                id: orderRef.tableSessionId,
                merchantId,
                status: 'OPEN',
                openTableId: orderRef.tableId,
              },
              data: {
                status: 'CLOSED',
                openTableId: null,
                closedAt: cancelledAt,
                discountPayableRateBps: null,
                discountAmountVnd: 0n,
                discountAppliedByStaffId: null,
                discountAppliedAt: null,
                roundingAmountVnd: 0n,
                roundingAppliedByStaffId: null,
              },
            });
            if (closed.count !== 1) {
              throw new ConflictException({
                code: 'TABLE_SESSION_STATUS_CHANGED',
                message: '桌账状态已变化，请刷新后重试',
              });
            }
          }

          await tx.orderStatusLog.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: 'CANCELLED',
              operatorType: OperatorType.MERCHANT_STAFF,
              operatorStaffId: staffId,
              action: 'ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN',
              metadata: {
                merchantId: merchantId.toString(),
                orderId: orderId.toString(),
                tableSessionId: orderRef.tableSessionId.toString(),
                tableId: orderRef.tableId.toString(),
                tableSessionAutoClosed: closeEmptySession,
                tableReleased: closeEmptySession,
                effectiveQuantityAfterAdjustment,
              },
              remark: closeEmptySession
                ? '订单退空自动取消，桌账已自动关闭并释放桌台'
                : '订单退空，订单已自动取消',
            },
          });
        }
      }

      if (!closeEmptySession) {
        await this.clearSessionAdjustment(tx, orderRef.tableSessionId);
      }

      return { orderId, sessionId: orderRef.tableSessionId };
    });

    return this.buildMutationResponse(merchantId, result.orderId, result.sessionId);
  }

  private normalizeCreateItems(dto: CreateTableOrderDto) {
    const normalized = new Map<
      string,
      { productId: bigint; quantity: number; remark?: string }
    >();
    for (const item of dto.items) {
      const productId = BigInt(item.productId);
      if (productId <= 0n) {
        throw new BadRequestException({
          code: 'PRODUCT_NOT_AVAILABLE',
          message: '菜品不存在',
        });
      }
      const remark = item.remark?.trim() || undefined;
      const key = `${productId.toString()}\u0000${remark ?? ''}`;
      const current = normalized.get(key);
      const quantity = (current?.quantity ?? 0) + item.quantity;
      if (quantity > 999) {
        throw new BadRequestException({
          code: 'INVALID_ITEM_QUANTITY',
          message: '单个菜品数量不能超过999',
        });
      }
      normalized.set(key, { productId, quantity, remark });
    }
    return [...normalized.values()];
  }

  private metadataMatchesAddOrder(
    value: Prisma.JsonValue,
    items: Array<{ productId: bigint; quantity: number; remark?: string }>,
  ) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const recorded = value.items;
    if (!Array.isArray(recorded)) return false;
    const canonical = (entries: Array<Record<string, unknown>>) =>
      entries
        .map((entry) => ({
          productId: String(entry.productId),
          quantity: Number(entry.quantity),
          remark:
            typeof entry.remark === 'string' && entry.remark.length > 0
              ? entry.remark
              : null,
        }))
        .sort((left, right) =>
          `${left.productId}\u0000${left.remark ?? ''}`.localeCompare(
            `${right.productId}\u0000${right.remark ?? ''}`,
          ),
        );
    const requested = items.map((item) => ({
      productId: item.productId.toString(),
      quantity: item.quantity,
      remark: item.remark ?? null,
    }));
    return (
      JSON.stringify(canonical(recorded as Array<Record<string, unknown>>)) ===
      JSON.stringify(canonical(requested))
    );
  }

  private metadataMatchesAdjustment(
    value: Prisma.JsonValue,
    input: {
      itemId: bigint;
      staffId: bigint;
      kind: ItemAdjustmentKind;
      expectedQuantity: number;
      targetQuantity: number;
    },
  ) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const changedQuantity = input.expectedQuantity - input.targetQuantity;
    return (
      value.orderItemId === input.itemId.toString() &&
      value.actorId === input.staffId.toString() &&
      value.beforeQuantity === input.expectedQuantity &&
      value.afterQuantity === input.targetQuantity &&
      (input.kind === 'RETURN'
        ? value.returnedQuantity === changedQuantity
        : value.decreasedQuantity === changedQuantity)
    );
  }

  private parseJsonValue(value: Prisma.JsonValue | string): Prisma.JsonValue {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as Prisma.JsonValue;
    } catch {
      return value;
    }
  }

  private async clearSessionAdjustment(
    tx: Prisma.TransactionClient,
    sessionId: bigint,
  ) {
    await tx.tableSession.updateMany({
      where: {
        id: sessionId,
        OR: [
          { discountPayableRateBps: { not: null } },
          { discountAmountVnd: { not: 0n } },
          { discountAppliedByStaffId: { not: null } },
          { roundingAppliedByStaffId: { not: null } },
          { roundingAmountVnd: { not: 0n } },
        ],
      },
      data: {
        discountPayableRateBps: null,
        discountAmountVnd: 0n,
        discountAppliedByStaffId: null,
        discountAppliedAt: null,
        roundingAmountVnd: 0n,
        roundingAppliedByStaffId: null,
      },
    });
  }

  private async buildMutationResponse(
    merchantId: bigint,
    orderId: bigint | null,
    sessionId: bigint,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const sessionResult = await this.tableSessions.getSessionDetailWithClient(
          tx,
          merchantId,
          sessionId,
        );
        return {
          order: orderId ? this.serializeMerchantOrder(
            await this.requireOrder(tx, merchantId, orderId),
          ) : null,
          session: sessionResult.session,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private generateOrderNo() {
    const timestamp = new Date()
      .toISOString()
      .replace(/\D/g, '')
      .slice(2, 14);
    return `HY${timestamp}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  settle(merchantId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, merchantId },
        select: { id: true, settlementStatus: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.settlementStatus === 'UNSETTLED') {
        await tx.order.updateMany({
          where: { id, merchantId, settlementStatus: 'UNSETTLED' },
          data: { settlementStatus: 'SETTLED' },
        });
      }
      return this.serializeMerchantOrder(
        await this.requireOrder(tx, merchantId, id),
      );
    });
  }

  async setRounding(
    merchantId: bigint,
    staffId: bigint,
    id: bigint,
    enabled: boolean,
  ) {
    return this.updateSettlementAdjustment(
      merchantId,
      staffId,
      id,
      { discountPayableRateBps: undefined, roundingEnabled: enabled },
      'ROUNDING',
    );
  }

  async setSettlementAdjustment(
    merchantId: bigint,
    staffId: bigint,
    id: bigint,
    input: { discountPayableRateBps: number | null; roundingEnabled: boolean },
  ) {
    return this.updateSettlementAdjustment(
      merchantId,
      staffId,
      id,
      {
        discountPayableRateBps: normalizeDiscountPayableRateBps(
          input.discountPayableRateBps,
        ),
        roundingEnabled: input.roundingEnabled,
      },
      'ADJUSTMENT',
    );
  }

  private async updateSettlementAdjustment(
    merchantId: bigint,
    staffId: bigint,
    id: bigint,
    input: {
      discountPayableRateBps: number | null | undefined;
      roundingEnabled: boolean;
    },
    source: 'ROUNDING' | 'ADJUSTMENT',
  ) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, merchantId },
        select: {
          id: true,
          orderType: true,
          status: true,
          settlementStatus: true,
          itemAmountVnd: true,
          deliveryFeeVnd: true,
          totalAmountVnd: true,
          discountPayableRateBps: true,
          discountAmountVnd: true,
          discountAppliedByStaffId: true,
          discountAppliedAt: true,
          roundingAmountVnd: true,
          roundingAppliedByStaffId: true,
          roundingAppliedAt: true,
          updatedAt: true,
        },
      });
      if (!current) {
        throw new NotFoundException('Order not found');
      }
      if (!['PICKUP', 'DELIVERY'].includes(current.orderType)) {
        throw new ConflictException({
          code: 'ORDER_ROUNDING_ORDER_TYPE_NOT_ALLOWED',
          message: '仅到店自取和商家配送订单可以抹零。',
        });
      }
      if (!ORDER_ROUNDING_STATUSES.includes(current.status)) {
        throw new ConflictException({
          code: 'ORDER_ROUNDING_STATUS_NOT_ALLOWED',
          message: '当前订单状态不允许抹零。',
        });
      }
      if (current.settlementStatus !== 'UNSETTLED') {
        throw new ConflictException({
          code: 'ORDER_ROUNDING_ALREADY_SETTLED',
          message: '订单已经结算，不能修改抹零。',
        });
      }

      const discountPayableRateBps = input.discountPayableRateBps === undefined
        ? current.discountPayableRateBps ?? null
        : input.discountPayableRateBps;
      const nonDiscountableFeeVnd = current.orderType === 'DELIVERY'
        ? current.deliveryFeeVnd ?? 0n
        : 0n;
      const itemAmountVnd = current.itemAmountVnd
        ?? current.totalAmountVnd - nonDiscountableFeeVnd;
      const amounts = calculateSettlementAdjustment({
        itemAmountVnd,
        nonDiscountableFeeVnd,
        discountPayableRateBps,
        roundingEnabled: input.roundingEnabled,
      });
      const currentlyApplied = current.roundingAppliedByStaffId !== null;
      const discountChanged =
        amounts.discountPayableRateBps !==
          (current.discountPayableRateBps ?? null) ||
        amounts.discountAmountVnd !== (current.discountAmountVnd ?? 0n);
      const roundingChanged =
        input.roundingEnabled !== currentlyApplied ||
        amounts.roundingAmountVnd !== current.roundingAmountVnd;
      if (
        !discountChanged &&
        !roundingChanged
      ) {
        return this.requireOrder(tx, merchantId, id);
      }

      const now = new Date();
      const updated = await tx.order.updateMany({
        where: {
          id,
          merchantId,
          orderType: current.orderType,
          status: current.status,
          settlementStatus: 'UNSETTLED',
          updatedAt: current.updatedAt,
        },
        data: {
          ...(discountChanged
            ? {
                discountPayableRateBps: amounts.discountPayableRateBps,
                discountAmountVnd: amounts.discountAmountVnd,
                discountAppliedByStaffId:
                  amounts.discountPayableRateBps === null ? null : staffId,
                discountAppliedAt:
                  amounts.discountPayableRateBps === null ? null : now,
              }
            : {}),
          ...(roundingChanged
            ? {
                roundingAmountVnd: amounts.roundingAmountVnd,
                roundingAppliedByStaffId: input.roundingEnabled ? staffId : null,
                roundingAppliedAt: input.roundingEnabled ? now : null,
              }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'ORDER_ROUNDING_CONCURRENT_UPDATE',
          message: '订单金额已被其他终端修改，请刷新后重试。',
        });
      }

      await tx.orderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: current.status,
          toStatus: current.status,
          operatorType: OperatorType.MERCHANT_STAFF,
          operatorStaffId: staffId,
          action: source === 'ROUNDING'
            ? input.roundingEnabled
              ? `${current.orderType}_ORDER_ROUNDING_APPLIED`
              : `${current.orderType}_ORDER_ROUNDING_CANCELLED`
            : `${current.orderType}_ORDER_SETTLEMENT_ADJUSTMENT_UPDATED`,
          metadata: {
            originalAmountVnd: current.totalAmountVnd.toString(),
            beforeRoundingAmountVnd: current.roundingAmountVnd.toString(),
            itemAmountVnd: itemAmountVnd.toString(),
            discountPayableRateBps: amounts.discountPayableRateBps,
            discountAmountVnd: amounts.discountAmountVnd.toString(),
            afterDiscountAmountVnd:
              amounts.discountedItemAmountVnd.toString(),
            nonDiscountableFeeVnd:
              amounts.nonDiscountableFeeVnd.toString(),
            roundingAmountVnd: amounts.roundingAmountVnd.toString(),
            payableAmountVnd: amounts.payableAmountVnd.toString(),
            operatorStaffId: staffId.toString(),
          },
          remark: source === 'ROUNDING'
            ? input.roundingEnabled
              ? '订单抹零'
              : '取消订单抹零'
            : '更新订单优惠',
        },
      });

      return this.requireOrder(tx, merchantId, id);
    });
    return this.serializeMerchantOrder(order);
  }

  private resolveRule(
    action: MerchantOrderAction,
    orderType: OrderType,
    currentStatus: OrderStatus,
  ): TransitionRule {
    if (action === 'REJECT' && currentStatus === 'ACCEPTED') {
      return {
        from: 'ACCEPTED',
        to: 'CANCELLED',
        remark: '商家取消已接订单',
      };
    }
    if (action === 'COMPLETE' && orderType === 'DELIVERY') {
      return {
        from: 'DELIVERING',
        to: 'COMPLETED',
        orderTypes: ['DELIVERY'],
        remark: '配送订单已完成',
      };
    }
    return TRANSITIONS[action];
  }

  private requireOrder(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    id: bigint,
  ) {
    return tx.order.findFirstOrThrow({
      where: { id, merchantId },
      include: this.detailInclude,
    });
  }

  private serializeMerchantOrder<
    T extends {
      orderType: OrderType;
      orderNo: string;
      createdAt: Date;
      readyAt: Date | null;
      totalAmountVnd?: bigint | number;
      itemAmountVnd?: bigint | number;
      deliveryFeeVnd?: bigint | number;
      discountPayableRateBps?: number | null;
      discountAmountVnd?: bigint | null;
      discountAppliedByStaffId?: bigint | null;
      discountAppliedAt?: Date | null;
      roundingAmountVnd?: bigint | null;
      roundingAppliedByStaffId?: bigint | null;
      roundingAppliedAt?: Date | null;
      items?: ReadonlyArray<{
        product?: { nameZh: string; nameVi: string | null } | null;
        [key: string]: unknown;
      }>;
      statusLogs?: ReadonlyArray<{
        action: string | null;
        metadata: Prisma.JsonValue | null;
        requestKey?: string | null;
        orderId?: bigint;
        operatorUserId?: bigint | null;
        operatorStaffId?: bigint | null;
        operatorStaff?: { id: bigint; displayName: string } | null;
      }>;
    },
  >(order: T) {
    const localizedOrder = {
      ...order,
      ...(order.items ? {
        items: order.items.map((item) => {
          if (!Object.prototype.hasOwnProperty.call(item, 'product')) return item;
          const { product, ...snapshot } = item;
          return {
            ...snapshot,
            productNameZh: product?.nameZh ?? null,
            productNameVi: product?.nameVi ?? null,
          };
        }),
      } : {}),
    };
    const pickupProjection = withPickupFulfillmentFields(localizedOrder);
    if (
      !['PICKUP', 'DELIVERY'].includes(pickupProjection.orderType) ||
      pickupProjection.totalAmountVnd === undefined
    ) {
      return pickupProjection;
    }
    const settlementOrder = pickupProjection as typeof pickupProjection & {
      totalAmountVnd: bigint | number;
    };
    if (!order.statusLogs) {
      return withOrderSettlementFields(settlementOrder);
    }
    return withOrderSettlementFields({
      ...localizedOrder,
      statusLogs: order.statusLogs.map(toMerchantVisibleOrderStatusLog),
    } as typeof settlementOrder);
  }

  private readonly listInclude = {
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    chatConversation: {
      select: {
        id: true,
        status: true,
        merchantUnreadCount: true,
        customerUnreadCount: true,
        lastMessageAt: true,
        lastMessageId: true,
        merchantLastReadAt: true,
        customerLastReadAt: true,
      },
    },
    items: {
      select: {
        id: true,
        productNameZhSnapshot: true,
        product: {
          select: { nameZh: true, nameVi: true },
        },
        quantity: true,
        subtotalVnd: true,
      },
    },
    printLogs: {
      select: {
        id: true,
        status: true,
        errorMessage: true,
        printedBy: true,
        createdAt: true,
        printerId: true,
      },
      orderBy: { createdAt: 'desc' as const },
      take: 20,
    },
  };

  private readonly detailInclude = {
    merchant: {
      select: { id: true, nameZh: true },
    },
    chatConversation: {
      select: {
        id: true,
        status: true,
        merchantUnreadCount: true,
        customerUnreadCount: true,
        lastMessageAt: true,
        lastMessageId: true,
        merchantLastReadAt: true,
        customerLastReadAt: true,
      },
    },
    user: {
      select: { id: true, nickname: true, phone: true },
    },
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    items: {
      orderBy: { id: 'asc' as const },
      include: {
        product: { select: { nameZh: true, nameVi: true } },
      },
    },
    statusLogs: {
      select: {
        id: true,
        orderId: true,
        fromStatus: true,
        toStatus: true,
        operatorType: true,
        operatorUserId: true,
        operatorStaffId: true,
        action: true,
        metadata: true,
        remark: true,
        createdAt: true,
        updatedAt: true,
        operatorStaff: {
          select: { id: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    },
    printLogs: {
      include: {
        printer: {
          // Historical display metadata only. LAN connection details remain in
          // the gated legacy printer API and are not exposed with every order.
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' as const },
      take: 10,
    },
  };
}

function toSettlementRow(order: {
  id: bigint;
  orderNo: string;
  status: OrderStatus;
  orderType: OrderType;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
  businessDate: Date | null;
  totalAmountVnd: bigint;
  itemAmountVnd: bigint;
  deliveryFeeVnd: bigint;
  discountPayableRateBps: number | null;
  discountAmountVnd: bigint | null;
  roundingAmountVnd: bigint | null;
  paymentMethod: PaymentMethod | null;
  tableId: bigint | null;
  tableSessionId: bigint | null;
  tableNoSnapshot: string | null;
  tableSession: {
    id: bigint;
    status: string;
    closedAt: Date | null;
    businessDate: Date | null;
    discountAmountVnd: bigint;
    roundingAmountVnd: bigint;
    paymentMethod: PaymentMethod | null;
  } | null;
  table: { id: bigint; tableNo: string; tableName: string | null } | null;
}): SettlementOrderRow {
  return {
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
    items: [],
  };
}

function weekdayKey(businessDate: string) {
  const [year, month, day] = businessDate.split('-').map(Number);
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ] as keyof ReturnType<typeof normalizeBusinessHours>;
}

function buildTopItemsBlocks(
  itemSummary: Array<{
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
    quantity: number;
  }>,
): PrintBlock[] {
  if (!itemSummary.length) return [{ type: 'DIVIDER' }];
  const topItems = [...itemSummary]
    .sort((left, right) =>
      right.quantity - left.quantity ||
      left.nameZh.localeCompare(right.nameZh, 'zh-Hans-CN'),
    )
    .slice(0, 10);
  const blocks: PrintBlock[] = [
    { type: 'DIVIDER' },
    textBlock('菜品销售 TOP10 / TOP10 món bán', true),
  ];
  topItems.forEach((item, index) => {
    blocks.push({
      type: 'ROW',
      left: formatBilingualDishName(item.nameVi, item.nameZh),
      right: `x ${item.quantity}`,
      bold: false,
    });
    if (index < topItems.length - 1) {
      blocks.push(textBlock('-'.repeat(32), false, 'SMALL'));
    }
  });
  return blocks;
}

function minutesOfDay(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function textBlock(
  text: string,
  bold: boolean,
  fontSize: 'SMALL' | 'NORMAL' | 'LARGE' = 'NORMAL',
  align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT',
): PrintBlock {
  return { type: 'TEXT', text, align, bold, fontSize, underline: false };
}
