import { effectiveOrderWhere, lockEffectivePrintTarget } from '../orders/effective-order';
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
import {
  canonicalPayloadHash,
  DineInCanonicalStateService,
  normalizeCanonicalText,
} from '../table-sessions/dine-in-canonical-state.service';
import type {
  DineInCanonicalDesiredItemDto,
  ReconcileDineInCanonicalStateDto,
} from '../table-sessions/dto/dine-in-canonical-state.dto';

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

const REUSABLE_DINE_IN_STAFF_ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'CANCELLED',
]);

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
  private readonly canonicalState: DineInCanonicalStateService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly printJobs: PrintJobsService,
    private readonly tableSessions: TableSessionsService,
    private readonly creatorInvariant: OrderCreatorInvariantService,
    private readonly pendingCancellation: PendingOrderCancellationService,
    canonicalState?: DineInCanonicalStateService,
  ) {
    this.canonicalState = canonicalState ?? new DineInCanonicalStateService(prisma);
  }

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
      where: effectiveOrderWhere({
        merchantId,
        status: query.status ?? (query.statuses?.length ? { in: query.statuses } : undefined),
        orderType: query.orderType,
        ...dateWhere,
      }),
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
      where: effectiveOrderWhere({
        merchantId,
        status: query.status ?? (query.statuses?.length ? { in: query.statuses } : undefined),
        orderType: query.orderType,
        ...dateWhere,
      }),
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
            openedAt: true,
            openedBusinessDate: true,
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
      where: effectiveOrderWhere({ id, merchantId }),
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

        const duplicate = await this.findStaffAddRequest(
          tx,
          merchantId,
          staffId,
          dto.idempotencyKey,
        );
        if (duplicate) {
          if (
            duplicate.tableId !== tableId ||
            !duplicate.tableSessionId ||
            !this.metadataMatchesAddOrder(
              duplicate.metadata,
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

        const lockedStaffOrders = await tx.$queryRaw<Array<{
          id: bigint;
          status: OrderStatus;
          user_id: bigint | null;
          created_by_staff_id: bigint | null;
          item_amount_vnd: bigint;
        }>>`
          SELECT id, status, user_id, created_by_staff_id, item_amount_vnd
          FROM orders
          WHERE table_session_id = ${session.id}
            AND merchant_id = ${merchantId}
            AND order_type = 'DINE_IN'
          ORDER BY id
          FOR UPDATE
        `;
        const duplicateAfterLock = await this.findStaffAddRequest(
          tx,
          merchantId,
          staffId,
          dto.idempotencyKey,
        );
        if (duplicateAfterLock) {
          if (
            duplicateAfterLock.tableId !== tableId
            || duplicateAfterLock.tableSessionId !== session.id
            || !this.metadataMatchesAddOrder(duplicateAfterLock.metadata, normalizedItems)
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: '点菜请求标识已用于其他请求',
            });
          }
          return {
            orderId: duplicateAfterLock.id,
            sessionId: session.id,
            printTriggerIds: [],
          };
        }

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
        const printDeltaItems = pricedItems.map((item) => ({
          productId: item.product.id.toString(),
          productNameSnapshot: item.product.name_zh,
          quantity: item.quantity,
          remark: item.remark ?? null,
          unitPriceVnd: item.product.price_vnd.toString(),
          subtotalVnd: item.subtotalVnd.toString(),
        }));
        const primary = lockedStaffOrders
          .filter((order) => order.user_id === null
            && order.created_by_staff_id !== null
            && REUSABLE_DINE_IN_STAFF_ORDER_STATUSES.has(order.status)
            && (order.status !== 'CANCELLED' || order.item_amount_vnd === 0n))
          .sort((left, right) => {
            const leftCancelled = left.status === 'CANCELLED' ? 1 : 0;
            const rightCancelled = right.status === 'CANCELLED' ? 1 : 0;
            return leftCancelled - rightCancelled
              || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
          })[0];
        let orderId: bigint;
        if (primary) {
          const restoreToAccepted = primary.status === 'PENDING_ACCEPTANCE'
            || primary.status === 'CANCELLED';
          const existingItems = await tx.orderItem.findMany({
            where: { orderId: primary.id },
            select: {
              id: true,
              productId: true,
              unitPriceVnd: true,
              quantity: true,
              remark: true,
            },
            orderBy: { id: 'asc' },
          });
          for (const item of pricedItems) {
            const existing = existingItems.find((candidate) =>
              candidate.productId === item.product.id
              && candidate.unitPriceVnd === item.product.price_vnd
              && normalizeCanonicalText(candidate.remark) === normalizeCanonicalText(item.remark),
            );
            if (existing) {
              const quantity = existing.quantity + item.quantity;
              await tx.orderItem.update({
                where: { id: existing.id },
                data: {
                  quantity,
                  subtotalVnd: item.product.price_vnd * BigInt(quantity),
                },
              });
            } else {
              await tx.orderItem.create({
                data: {
                  orderId: primary.id,
                  productId: item.product.id,
                  productNameZhSnapshot: item.product.name_zh,
                  imageUrlSnapshot: item.product.image_url,
                  unitPriceVnd: item.product.price_vnd,
                  quantity: item.quantity,
                  subtotalVnd: item.subtotalVnd,
                  remark: item.remark || undefined,
                },
              });
            }
          }
          const aggregate = await tx.orderItem.aggregate({
            where: { orderId: primary.id },
            _sum: { subtotalVnd: true },
          });
          const total = aggregate._sum.subtotalVnd ?? 0n;
          await tx.order.update({
            where: { id: primary.id },
            data: {
              status: restoreToAccepted ? 'ACCEPTED' : primary.status,
              acceptedAt: restoreToAccepted ? createdAt : undefined,
              cancelledAt: primary.status === 'CANCELLED' ? null : undefined,
              cancelReason: primary.status === 'CANCELLED' ? null : undefined,
              itemAmountVnd: total,
              totalAmountVnd: total,
            },
          });
          await tx.orderStatusLog.create({
            data: {
              orderId: primary.id,
              fromStatus: primary.status,
              toStatus: restoreToAccepted ? 'ACCEPTED' : primary.status,
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
                items: printDeltaItems,
                printDeltaItems,
                reusedOrder: true,
                restoredCancelledOrder: primary.status === 'CANCELLED',
                autoAcceptedPendingOrder: primary.status === 'PENDING_ACCEPTANCE',
              },
              remark: restoreToAccepted
                ? '商家点菜恢复原员工单并追加菜品'
                : '商家点菜追加到当前员工单',
            },
          });
          orderId = primary.id;
        } else {
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
              acceptedAt: createdAt,
              items: { create: pricedItems.map((item) => ({
                productId: item.product.id,
                productNameZhSnapshot: item.product.name_zh,
                imageUrlSnapshot: item.product.image_url,
                unitPriceVnd: item.product.price_vnd,
                quantity: item.quantity,
                subtotalVnd: item.subtotalVnd,
                remark: item.remark || undefined,
              })) },
              statusLogs: { create: [{
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
                  items: printDeltaItems,
                  printDeltaItems,
                  reusedOrder: false,
                },
                remark: '商家点菜创建员工单并自动接单',
              }] },
            },
            select: { id: true },
          });
          orderId = created.id;
        }
        // Any order mutation invalidates the current settlement adjustment.
        // Clear it atomically so refresh/checkout/printing cannot reuse a
        // discount or rounding amount calculated from an older bill total.
        await this.clearSessionAdjustment(tx, session.id);
        return {
          orderId,
          sessionId: session.id,
          printTriggerIds: [],
        };
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const duplicate = await this.findStaffAddRequest(
        this.prisma,
        merchantId,
        staffId,
        dto.idempotencyKey,
      );
      if (!duplicate) {
        throw error;
      }
      if (
        !duplicate.tableSessionId ||
        duplicate.tableId !== tableId ||
        !this.metadataMatchesAddOrder(
          duplicate.metadata,
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

  async reconcileDineInCanonicalState(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
    dto: ReconcileDineInCanonicalStateDto,
  ) {
    const desired = this.normalizeCanonicalDesiredItems(dto.desiredItems);
    const payloadHash = canonicalPayloadHash({
      sessionId: sessionId.toString(),
      baseRevision: dto.baseRevision,
      desiredItems: desired.map((item) => ({
        lineKey: item.lineKey ?? null,
        productId: item.productId?.toString() ?? null,
        remark: item.remark,
        desiredQuantity: item.desiredQuantity,
      })),
    });
    const sessionRef = await this.prisma.tableSession.findFirst({
      where: { id: sessionId, merchantId },
      select: { id: true, tableId: true },
    });
    if (!sessionRef) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const creator = await this.creatorInvariant.assertValid(tx, {
        merchantId,
        userId: null,
        createdByStaffId: staffId,
      });
      const tableRows = await tx.$queryRaw<Array<{
        id: bigint;
        table_no: string;
        status: string;
      }>>`
        SELECT id, table_no, status
        FROM dining_tables
        WHERE id = ${sessionRef.tableId} AND merchant_id = ${merchantId}
        FOR UPDATE
      `;
      const table = tableRows[0];
      if (!table) {
        throw new NotFoundException({ code: 'TABLE_NOT_FOUND', message: '桌台不存在' });
      }

      const before = await this.canonicalState.buildLockedWithClient(
        tx,
        merchantId,
        sessionId,
      );
      if (before.tableId !== sessionRef.tableId.toString()) {
        throw new ConflictException({
          code: 'TABLE_SESSION_TABLE_CHANGED',
          message: '桌台已变化，请刷新后重试。',
          latestState: this.canonicalState.toPublicState(before),
        });
      }

      const priorRows = await tx.$queryRaw<Array<{
        action: string | null;
        metadata: Prisma.JsonValue | string | null;
      }>>`
        SELECT osl.action, osl.metadata
        FROM order_status_logs osl
        INNER JOIN orders o ON o.id = osl.order_id
        WHERE o.table_session_id = ${sessionId}
          AND o.merchant_id = ${merchantId}
          AND osl.request_key = ${dto.requestKey}
        ORDER BY osl.id
        FOR UPDATE
      `;
      if (priorRows.length > 0) {
        const matches = priorRows.every((entry) => {
          const metadata = this.parseJsonRecord(entry.metadata);
          return entry.action === 'DINE_IN_CANONICAL_RECONCILED'
            && metadata.payloadHash === payloadHash;
        });
        if (!matches) {
          throw new ConflictException({
            code: 'CANONICAL_REQUEST_KEY_CONFLICT',
            message: '请求标识已用于其他桌账操作。',
          });
        }
        return {
          state: this.canonicalState.toPublicState(before),
          idempotentReplay: true,
          releasedBecause: priorRows.some((entry) =>
            this.parseJsonRecord(entry.metadata).tableSessionAutoClosed === true,
          ) ? 'EMPTY_AFTER_RECONCILE' as const : undefined,
          printTriggerIds: [] as bigint[],
        };
      }

      this.canonicalState.assertOpenDineInState(before);
      if (before.revision !== dto.baseRevision) {
        throw new ConflictException({
          code: 'CANONICAL_REVISION_CONFLICT',
          message: '桌账已变化，请核对最新菜品数量。',
          latestState: this.canonicalState.toPublicState(before),
        });
      }

      const existingByKey = new Map(before.items.map((item) => [item.lineKey, item]));
      const desiredExisting = new Map(
        desired.filter((item) => item.lineKey).map((item) => [item.lineKey!, item]),
      );
      for (const lineKey of desiredExisting.keys()) {
        if (!existingByKey.has(lineKey)) {
          throw new ConflictException({
            code: 'CANONICAL_LINE_NOT_FOUND',
            message: '菜品行已变化，请刷新后重试。',
            latestState: this.canonicalState.toPublicState(before),
          });
        }
      }

      const positive = new Map<string, {
        productId: bigint;
        quantity: number;
        remark: string;
        expectedUnitPriceVnd?: bigint;
      }>();
      const negative: Array<{
        line: (typeof before.items)[number];
        removeQuantity: number;
        desiredQuantity: number;
      }> = [];
      const lineChanges: Array<{
        lineKey: string | null;
        productId: string | null;
        remark: string;
        unitPriceVnd: string | null;
        beforeQuantity: number;
        afterQuantity: number;
      }> = [];

      for (const line of before.items) {
        const target = desiredExisting.get(line.lineKey)?.desiredQuantity ?? 0;
        if (target < line.lockedQuantity) {
          throw new ConflictException({
            code: 'CANONICAL_LINE_LOCKED',
            message: '该菜品已有不可调整数量，请按最新桌账处理。',
            lineKey: line.lineKey,
            lockedQuantity: line.lockedQuantity,
            latestState: this.canonicalState.toPublicState(before),
          });
        }
        if (target > line.quantity) {
          if (!line.productId) {
            throw new ConflictException({
              code: 'CANONICAL_LINE_LOCKED',
              message: '历史菜品无法继续增加。',
              lineKey: line.lineKey,
            });
          }
          positive.set(`line:${line.lineKey}`, {
            productId: BigInt(line.productId),
            quantity: target - line.quantity,
            remark: line.remark,
            expectedUnitPriceVnd: BigInt(line.unitPriceVnd),
          });
        } else if (target < line.quantity) {
          negative.push({
            line,
            removeQuantity: line.quantity - target,
            desiredQuantity: target,
          });
        }
        if (target !== line.quantity) {
          lineChanges.push({
            lineKey: line.lineKey,
            productId: line.productId,
            remark: line.remark,
            unitPriceVnd: line.unitPriceVnd,
            beforeQuantity: line.quantity,
            afterQuantity: target,
          });
        }
      }

      for (const item of desired.filter((entry) => entry.productId)) {
        if (item.desiredQuantity <= 0) continue;
        const key = `new:${item.productId!.toString()}\u0000${item.remark}`;
        positive.set(key, {
          productId: item.productId!,
          quantity: item.desiredQuantity,
          remark: item.remark,
        });
        lineChanges.push({
          lineKey: null,
          productId: item.productId!.toString(),
          remark: item.remark,
          unitPriceVnd: null,
          beforeQuantity: 0,
          afterQuantity: item.desiredQuantity,
        });
      }

      if (positive.size === 0 && negative.length === 0) {
        return {
          state: this.canonicalState.toPublicState(before),
          idempotentReplay: false,
          releasedBecause: undefined,
          printTriggerIds: [] as bigint[],
        };
      }

      const merchant = await tx.merchant.findUnique({
        where: { id: merchantId },
        select: { businessHours: true },
      });
      const positiveRows = [...positive.values()];
      const productIds = [...new Set(positiveRows.map((item) => item.productId))]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      const products = productIds.length
        ? await tx.$queryRaw<LockedProductRow[]>(Prisma.sql`
            SELECT p.id, p.name_zh, p.image_url, p.price_vnd,
                   p.product_type, p.status, p.deleted_at,
                   c.is_active AS category_active
            FROM products p
            INNER JOIN categories c ON c.id = p.category_id
            WHERE p.merchant_id = ${merchantId}
              AND p.id IN (${Prisma.join(productIds)})
            ORDER BY p.id
            FOR SHARE
          `)
        : [];
      const productsById = new Map(products.map((product) => [product.id, product]));
      const pricedPositive = positiveRows.map((item) => {
        const product = productsById.get(item.productId);
        if (
          !product
          || product.product_type !== 'FOOD'
          || product.status !== 'ON_SALE'
          || product.deleted_at !== null
          || !Boolean(product.category_active)
        ) {
          throw new ConflictException({
            code: 'PRODUCT_NOT_AVAILABLE',
            message: '菜品已下架、售罄或不属于当前商家。',
          });
        }
        if (
          item.expectedUnitPriceVnd !== undefined
          && item.expectedUnitPriceVnd !== product.price_vnd
        ) {
          throw new ConflictException({
            code: 'CANONICAL_LINE_PRICE_CHANGED',
            message: '菜品价格已变化，请从菜单重新添加。',
            latestState: this.canonicalState.toPublicState(before),
          });
        }
        return {
          ...item,
          product,
          subtotalVnd: product.price_vnd * BigInt(item.quantity),
        };
      });

      let positiveOrderId: bigint | null = null;
      const printDeltaItems: Array<{
        productId: string;
        productNameSnapshot: string;
        quantity: number;
        remark: string | null;
        unitPriceVnd: string;
        subtotalVnd: string;
      }> = [];
      if (pricedPositive.length > 0) {
        const createdAt = new Date();
        const primary = [...before.orders]
          .filter((order) => order.orderType === 'DINE_IN'
            && order.userId === null
            && order.createdByStaffId !== null
            && REUSABLE_DINE_IN_STAFF_ORDER_STATUSES.has(order.status)
            && (order.status !== 'CANCELLED' || order.itemAmountVnd === 0n))
          .sort((left, right) => {
            const leftCancelled = left.status === 'CANCELLED' ? 1 : 0;
            const rightCancelled = right.status === 'CANCELLED' ? 1 : 0;
            return leftCancelled - rightCancelled
              || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
          })[0];

        if (primary) {
          const restoreToAccepted = primary.status === 'PENDING_ACCEPTANCE'
            || primary.status === 'CANCELLED';
          positiveOrderId = primary.id;
          for (const item of pricedPositive) {
            const existingLine = before.items.find((line) =>
              line.productId === item.product.id.toString()
              && line.remark === item.remark
              && line.unitPriceVnd === item.product.price_vnd.toString(),
            );
            const existingRaw = existingLine?.rawItems.find(
              (raw) => raw.orderId === primary.id,
            );
            if (existingRaw) {
              const nextQuantity = existingRaw.quantity + item.quantity;
              await tx.orderItem.update({
                where: { id: existingRaw.itemId },
                data: {
                  quantity: nextQuantity,
                  subtotalVnd: item.product.price_vnd * BigInt(nextQuantity),
                },
              });
            } else {
              await tx.orderItem.create({
                data: {
                  orderId: primary.id,
                  productId: item.product.id,
                  productNameZhSnapshot: item.product.name_zh,
                  imageUrlSnapshot: item.product.image_url,
                  unitPriceVnd: item.product.price_vnd,
                  quantity: item.quantity,
                  subtotalVnd: item.subtotalVnd,
                  remark: item.remark || undefined,
                },
              });
            }
            printDeltaItems.push({
              productId: item.product.id.toString(),
              productNameSnapshot: item.product.name_zh,
              quantity: item.quantity,
              remark: item.remark || null,
              unitPriceVnd: item.product.price_vnd.toString(),
              subtotalVnd: item.subtotalVnd.toString(),
            });
          }
          const aggregate = await tx.orderItem.aggregate({
            where: { orderId: primary.id },
            _sum: { subtotalVnd: true },
          });
          const itemAmountVnd = aggregate._sum.subtotalVnd ?? 0n;
          await tx.order.update({
            where: { id: primary.id },
            data: {
              status: restoreToAccepted ? 'ACCEPTED' : primary.status,
              acceptedAt: restoreToAccepted ? createdAt : undefined,
              cancelledAt: primary.status === 'CANCELLED' ? null : undefined,
              cancelReason: primary.status === 'CANCELLED' ? null : undefined,
              itemAmountVnd,
              totalAmountVnd: itemAmountVnd,
            },
          });
        } else {
          const itemAmountVnd = pricedPositive.reduce((sum, item) => sum + item.subtotalVnd, 0n);
          const created = await tx.order.create({
            data: {
              orderNo: this.generateOrderNo(),
              idempotencyKey: dto.requestKey,
              userId: null,
              createdByStaffId: staffId,
              merchantId,
              tableId: sessionRef.tableId,
              tableSessionId: sessionId,
              tableNoSnapshot: table.table_no,
              orderType: 'DINE_IN',
              itemAmountVnd,
              deliveryFeeVnd: 0n,
              totalAmountVnd: itemAmountVnd,
              businessDate: businessDateSnapshotValue(merchant?.businessHours ?? null, createdAt),
              createdAt,
              status: 'ACCEPTED',
              acceptedAt: createdAt,
              items: {
                create: pricedPositive.map((item) => ({
                  productId: item.product.id,
                  productNameZhSnapshot: item.product.name_zh,
                  imageUrlSnapshot: item.product.image_url,
                  unitPriceVnd: item.product.price_vnd,
                  quantity: item.quantity,
                  subtotalVnd: item.subtotalVnd,
                  remark: item.remark || undefined,
                })),
              },
            },
            select: { id: true },
          });
          positiveOrderId = created.id;
          printDeltaItems.push(...pricedPositive.map((item) => ({
            productId: item.product.id.toString(),
            productNameSnapshot: item.product.name_zh,
            quantity: item.quantity,
            remark: item.remark || null,
            unitPriceVnd: item.product.price_vnd.toString(),
            subtotalVnd: item.subtotalVnd.toString(),
          })));
        }
      }

      const touchedOrderIds = new Set<bigint>();
      for (const change of negative) {
        let remaining = change.removeQuantity;
        for (const raw of change.line.rawItems) {
          if (remaining <= 0) break;
          if (!['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY'].includes(raw.orderStatus)) continue;
          const decrease = Math.min(remaining, raw.quantity);
          const targetQuantity = raw.quantity - decrease;
          const afterSubtotalVnd = raw.unitPriceVnd * BigInt(targetQuantity);
          if (targetQuantity === 0) await tx.orderItem.delete({ where: { id: raw.itemId } });
          else {
            await tx.orderItem.updateMany({
              where: {
                id: raw.itemId,
                productionNotifiedQuantity: { gt: targetQuantity },
              },
              data: { productionNotifiedQuantity: targetQuantity },
            });
            await tx.orderItem.update({
              where: { id: raw.itemId },
              data: { quantity: targetQuantity, subtotalVnd: afterSubtotalVnd },
            });
          }
          await tx.orderStatusLog.create({
            data: {
              orderId: raw.orderId,
              fromStatus: raw.orderStatus,
              toStatus: raw.orderStatus,
              operatorType: OperatorType.MERCHANT_STAFF,
              operatorStaffId: staffId,
              action: raw.orderStatus === 'PENDING_ACCEPTANCE'
                ? 'ORDER_ITEM_DECREASED'
                : 'ORDER_ITEM_RETURNED',
              metadata: {
                canonicalRequestKey: dto.requestKey,
                lineKey: change.line.lineKey,
                orderItemId: raw.itemId.toString(),
                beforeQuantity: raw.quantity,
                afterQuantity: targetQuantity,
                delta: -decrease,
                unitPriceVnd: raw.unitPriceVnd.toString(),
                tableSessionAutoClosed: false,
                tableReleased: false,
              },
              remark: raw.orderStatus === 'PENDING_ACCEPTANCE'
                ? '整桌目标态减少未接单菜品'
                : '整桌目标态退菜',
            },
          });
          touchedOrderIds.add(raw.orderId);
          remaining -= decrease;
        }
        if (remaining > 0) {
          throw new ConflictException({
            code: 'CANONICAL_LINE_LOCKED',
            message: '可调整菜品数量不足，请刷新后重试。',
            lineKey: change.line.lineKey,
          });
        }
      }

      for (const orderId of [...touchedOrderIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
        const order = await tx.order.findFirst({
          where: effectiveOrderWhere({ id: orderId, merchantId, tableSessionId: sessionId }),
          select: { id: true, status: true, deliveryFeeVnd: true },
        });
        if (!order) {
          throw new ConflictException({
            code: 'ORDER_STATUS_CHANGED',
            message: '订单状态已变化，请刷新后重试。',
          });
        }
        const aggregate = await tx.orderItem.aggregate({
          where: { orderId },
          _sum: { subtotalVnd: true },
          _count: { id: true },
        });
        const itemAmountVnd = aggregate._sum.subtotalVnd ?? 0n;
        const totalAmountVnd = itemAmountVnd + order.deliveryFeeVnd;
        if (aggregate._count.id > 0) {
          await tx.order.update({
            where: { id: orderId },
            data: { itemAmountVnd, totalAmountVnd },
          });
          continue;
        }
        if (order.status === 'PENDING_ACCEPTANCE') {
          await this.pendingCancellation.cancel(tx, {
            orderId,
            merchantId,
            operatorStaffId: staffId,
            reason: '整桌目标态将未接单订单全部减为零，订单已取消',
            itemAmountVnd,
            totalAmountVnd,
            internalAudit: {
              action: 'ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN',
              metadata: {
                visibility: 'INTERNAL',
                cancelKind: 'DINE_IN_CANONICAL_REBALANCE',
                canonicalRequestKey: dto.requestKey,
                tableSessionId: sessionId.toString(),
                tableSessionAutoClosed: false,
                tableReleased: false,
              },
            },
          });
        } else {
          const cancelled = await tx.order.updateMany({
            where: effectiveOrderWhere({
              id: orderId,
              merchantId,
              tableSessionId: sessionId,
              status: order.status,
            }),
            data: {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelReason: '整桌目标态退空订单，订单已自动取消',
              itemAmountVnd,
              totalAmountVnd,
            },
          });
          if (cancelled.count !== 1) {
            throw new ConflictException({
              code: 'ORDER_STATUS_CHANGED',
              message: '订单状态已变化，请刷新后重试。',
            });
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
                visibility: 'INTERNAL',
                cancelKind: 'DINE_IN_CANONICAL_REBALANCE',
                canonicalRequestKey: dto.requestKey,
                tableSessionId: sessionId.toString(),
                tableSessionAutoClosed: false,
                tableReleased: false,
              },
              remark: '订单退空，订单已自动取消，桌台保持用餐中',
            },
          });
        }
      }

      await this.clearSessionAdjustment(tx, sessionId);
      let after = await this.canonicalState.buildLockedWithClient(
        tx,
        merchantId,
        sessionId,
      );
      const anchorOrderId = positiveOrderId
        ?? [...touchedOrderIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)[0];
      let tableSessionAutoClosed = false;
      if (
        after.items.length === 0
        && after.totals.originalAmountVnd === '0'
        && after.totals.payableAmountVnd === '0'
        && after.blockers.length === 0
      ) {
        const closedAt = new Date();
        const closed = await tx.tableSession.updateMany({
          where: {
            id: sessionId,
            merchantId,
            status: 'OPEN',
            openTableId: sessionRef.tableId,
          },
          data: {
            status: 'CLOSED',
            openTableId: null,
            closedAt,
          },
        });
        if (closed.count !== 1) {
          throw new ConflictException({
            code: 'TABLE_SESSION_EXTERNALLY_CLOSED',
            message: '桌账已由其他终端关闭。',
            latestState: this.canonicalState.toPublicState(after),
          });
        }
        tableSessionAutoClosed = true;
        if (anchorOrderId) {
          const anchor = await tx.order.findUnique({
            where: { id: anchorOrderId },
            select: { status: true },
          });
          if (!anchor) {
            throw new ConflictException({ code: 'ORDER_NOT_FOUND', message: '订单不存在' });
          }
          await tx.orderStatusLog.create({
            data: {
              orderId: anchorOrderId,
              fromStatus: anchor.status,
              toStatus: anchor.status,
              operatorType: OperatorType.MERCHANT_STAFF,
              operatorStaffId: staffId,
              action: 'DINE_IN_AUTO_RELEASED_EMPTY',
              metadata: {
                visibility: 'INTERNAL',
                canonicalRequestKey: dto.requestKey,
                tableSessionId: sessionId.toString(),
                tableId: sessionRef.tableId.toString(),
                tableSessionAutoClosed: true,
                tableReleased: true,
                settlementCreated: false,
                paymentCreated: false,
                checkoutPrintTriggered: false,
              },
              remark: '堂食目标态已清空，桌账自动关闭并释放桌台',
            },
          });
        }
        after = await this.canonicalState.buildLockedWithClient(
          tx,
          merchantId,
          sessionId,
        );
      }
      const printTriggerIds: bigint[] = [];
      if (anchorOrderId) {
        const anchor = await tx.order.findUnique({
          where: { id: anchorOrderId },
          select: { status: true },
        });
        if (!anchor) throw new ConflictException({ code: 'ORDER_NOT_FOUND', message: '订单不存在' });
        await tx.orderStatusLog.create({
          data: {
            orderId: anchorOrderId,
            fromStatus: anchor.status,
            toStatus: anchor.status,
            operatorType: OperatorType.MERCHANT_STAFF,
            operatorStaffId: staffId,
            action: 'DINE_IN_CANONICAL_RECONCILED',
            requestKey: dto.requestKey,
            metadata: {
              payloadHash,
              baseRevision: dto.baseRevision,
              appliedRevision: after.revision,
              tableSessionId: sessionId.toString(),
              tableId: sessionRef.tableId.toString(),
              actorId: staffId.toString(),
              actorRole: creator.staffRole,
              lineChanges,
              positiveOrderId: positiveOrderId?.toString() ?? null,
              printDeltaItems,
              touchedOrderIds: [...touchedOrderIds].map((id) => id.toString()),
              tableSessionAutoClosed,
              tableReleased: tableSessionAutoClosed,
              visibility: 'INTERNAL',
            },
            remark: tableSessionAutoClosed
              ? '堂食整桌目标态已对账，空账已自动释放'
              : '堂食整桌目标态已对账',
          },
        });
      }
      return {
        state: this.canonicalState.toPublicState(after),
        idempotentReplay: false,
        releasedBecause: tableSessionAutoClosed
          ? 'EMPTY_AFTER_RECONCILE' as const
          : undefined,
        printTriggerIds,
      };
    });

    if (result.printTriggerIds.length > 0) {
      try {
        await this.printJobs.processAutomaticTriggerIds(result.printTriggerIds);
      } catch (error) {
        this.logger.warn(
          `Canonical reconcile print processing deferred merchant=${merchantId} session=${sessionId} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }
    const productionNotification = await this.printJobs.getProductionNotificationState(
      merchantId,
      sessionId,
    );
    return {
      ...result.state,
      productionNotification,
      idempotentReplay: result.idempotentReplay,
      appliedRevision: result.state.revision,
      ...(result.releasedBecause ? { releasedBecause: result.releasedBecause } : {}),
    };
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
        where: effectiveOrderWhere({ id, merchantId }),
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
        where: effectiveOrderWhere({ id, merchantId, status: rule.from }),
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
      where: effectiveOrderWhere({
        merchantId,
        status: 'COMPLETED',
        ...businessDateCandidateWhere(schedule, businessDate),
      }),
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
            openedAt: true,
            openedBusinessDate: true,
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
      summaryMoneyRow('折扣 / Giảm giá', money(summary.discountAmountVnd)),
      summaryMoneyRow('抹零 / Làm tròn', money(summary.roundingAmountVnd)),
      summaryMoneyRow('总收入 / Doanh thu', money(summary.totalRevenueVnd), true),
      summaryMoneyRow('现金 / Tiền mặt', money(summary.cashRevenueVnd)),
      summaryMoneyRow('银行转账 / Chuyển khoản', money(summary.bankTransferRevenueVnd)),
      ...(summary.unrecordedRevenueVnd !== '0'
        ? [summaryMoneyRow('历史未记录 / Chưa ghi nhận', money(summary.unrecordedRevenueVnd))]
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
        where: effectiveOrderWhere({ id: orderId, merchantId }),
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
        await tx.orderItem.updateMany({
          where: {
            id: itemId,
            productionNotifiedQuantity: { gt: input.targetQuantity },
          },
          data: { productionNotifiedQuantity: input.targetQuantity },
        });
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
      if (!cancelEmptyOrder) {
        const updated = await tx.order.updateMany({
          where: effectiveOrderWhere({
            id: orderId,
            merchantId,
            status: order.status,
            tableSessionId: orderRef.tableSessionId,
          }),
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
            tableSessionAutoClosed: false,
            tableReleased: false,
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
            where: effectiveOrderWhere({
              id: orderId,
              merchantId,
              status: order.status,
              tableSessionId: orderRef.tableSessionId,
            }),
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
                tableSessionAutoClosed: false,
                tableReleased: false,
                effectiveQuantityAfterAdjustment,
              },
              remark: '订单退空，订单已自动取消，桌台保持用餐中',
            },
          });
        }
      }

      // Emptying a raw order never releases a DINE_IN table. Only the explicit
      // release-empty endpoint may close the still-open zero-item session.
      await this.clearSessionAdjustment(tx, orderRef.tableSessionId);

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

  private normalizeCanonicalDesiredItems(
    items: DineInCanonicalDesiredItemDto[],
  ) {
    const seen = new Set<string>();
    return items.map((item) => {
      const hasLineKey = Boolean(item.lineKey);
      const hasProductId = Boolean(item.productId);
      if (hasLineKey === hasProductId) {
        throw new BadRequestException({
          code: 'INVALID_CANONICAL_DESIRED_ITEM',
          message: '每个目标菜品必须且只能指定 lineKey 或 productId。',
        });
      }
      const remark = normalizeCanonicalText(item.remark);
      const productId = item.productId ? BigInt(item.productId) : undefined;
      const key = item.lineKey
        ? `line:${item.lineKey}`
        : `product:${productId!.toString()}\u0000${remark}`;
      if (seen.has(key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_CANONICAL_DESIRED_ITEM',
          message: '目标菜品列表包含重复行。',
        });
      }
      seen.add(key);
      return {
        lineKey: item.lineKey,
        productId,
        remark,
        desiredQuantity: item.desiredQuantity,
      };
    });
  }

  private parseJsonRecord(value: Prisma.JsonValue | string | null) {
    if (!value) return {} as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {} as Record<string, unknown>;
  }

  private async findStaffAddRequest(
    client: PrismaService | Prisma.TransactionClient,
    merchantId: bigint,
    staffId: bigint,
    requestKey: string,
  ) {
    const log = await client.orderStatusLog.findFirst({
      where: {
        action: 'MERCHANT_ADD_ITEMS',
        requestKey,
        operatorStaffId: staffId,
        order: {
          merchantId,
          orderType: 'DINE_IN',
          userId: null,
          createdByStaffId: { not: null },
        },
      },
      select: {
        metadata: true,
        order: {
          select: {
            id: true,
            tableId: true,
            tableSessionId: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return log
      ? {
          id: log.order.id,
          tableId: log.order.tableId,
          tableSessionId: log.order.tableSessionId,
          metadata: log.metadata,
        }
      : null;
  }

  private metadataMatchesAddOrder(
    value: Prisma.JsonValue | null,
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
      await lockEffectivePrintTarget(tx, merchantId, { orderId: id });
      const order = await tx.order.findFirst({
        where: effectiveOrderWhere({ id, merchantId }),
        select: { id: true, settlementStatus: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.settlementStatus === 'UNSETTLED') {
        await tx.order.updateMany({
          where: effectiveOrderWhere({ id, merchantId, settlementStatus: 'UNSETTLED' }),
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
    input: {
      discountPayableRateBps: number | null;
      discountAmountVnd?: string;
      roundingEnabled: boolean;
    },
  ) {
    const discountPayableRateBps = normalizeDiscountPayableRateBps(
      input.discountPayableRateBps,
    );
    const discountAmountVnd = input.discountAmountVnd === undefined
      ? undefined
      : BigInt(input.discountAmountVnd);
    if (discountPayableRateBps !== null && discountAmountVnd !== undefined) {
      throw new BadRequestException({
        code: 'DISCOUNT_INPUT_CONFLICT',
        message: '折扣百分比与固定减免金额不能同时提交。',
      });
    }
    return this.updateSettlementAdjustment(
      merchantId,
      staffId,
      id,
      {
        discountPayableRateBps,
        discountAmountVnd,
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
      discountAmountVnd?: bigint;
      roundingEnabled: boolean;
    },
    source: 'ROUNDING' | 'ADJUSTMENT',
  ) {
    const order = await this.prisma.$transaction(async (tx) => {
      await lockEffectivePrintTarget(tx, merchantId, { orderId: id });
      const current = await tx.order.findFirst({
        where: effectiveOrderWhere({ id, merchantId }),
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
      const fixedDiscountAmountVnd = input.discountAmountVnd !== undefined
        ? input.discountAmountVnd
        : input.discountPayableRateBps === undefined
          && current.discountPayableRateBps === null
          && current.discountAmountVnd > 0n
          ? current.discountAmountVnd
          : undefined;
      if (fixedDiscountAmountVnd !== undefined && fixedDiscountAmountVnd > itemAmountVnd) {
        throw new BadRequestException({
          code: 'DISCOUNT_AMOUNT_EXCEEDS_ITEM_AMOUNT',
          message: '减免金额不能超过商品金额。',
        });
      }
      const amounts = calculateSettlementAdjustment({
        itemAmountVnd,
        nonDiscountableFeeVnd,
        discountPayableRateBps,
        discountAmountVnd: fixedDiscountAmountVnd,
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
        where: effectiveOrderWhere({
          id,
          merchantId,
          orderType: current.orderType,
          status: current.status,
          settlementStatus: 'UNSETTLED',
          updatedAt: current.updatedAt,
        }),
        data: {
          ...(discountChanged
            ? {
                discountPayableRateBps: amounts.discountPayableRateBps,
                discountAmountVnd: amounts.discountAmountVnd,
                discountAppliedByStaffId:
                  amounts.discountAmountVnd === 0n ? null : staffId,
                discountAppliedAt:
                  amounts.discountAmountVnd === 0n ? null : now,
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
      where: effectiveOrderWhere({ id, merchantId }),
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
    const visibleOrder = order.statusLogs
      ? {
          ...localizedOrder,
          statusLogs: order.statusLogs.map(toMerchantVisibleOrderStatusLog),
        }
      : localizedOrder;
    const pickupProjection = withPickupFulfillmentFields(visibleOrder);
    if (
      !['PICKUP', 'DELIVERY'].includes(pickupProjection.orderType) ||
      pickupProjection.totalAmountVnd === undefined
    ) {
      return pickupProjection;
    }
    const settlementOrder = pickupProjection as typeof pickupProjection & {
      totalAmountVnd: bigint | number;
    };
    return withOrderSettlementFields(settlementOrder);
  }

  private readonly listInclude = {
    tableSession: { select: { openedAt: true, openedBusinessDate: true } },
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
    openedAt?: Date;
    openedBusinessDate?: Date | null;
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

function summaryMoneyRow(left: string, right: string, bold = false): PrintBlock {
  // Match the breathing room between dish rows without inserting a separator.
  return { type: 'ROW', left, right, bold, fontSize: 'LARGE', gapBeforeDots: 24 };
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
