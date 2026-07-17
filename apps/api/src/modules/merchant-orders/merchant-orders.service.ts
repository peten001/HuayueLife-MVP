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
  category_active: number | boolean;
};

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

  list(merchantId: bigint, query: ListMerchantOrdersQueryDto) {
    const createdAt = query.date ? this.dateRange(query.date) : undefined;
    return this.prisma.order.findMany({
      where: {
        merchantId,
        status: query.status,
        orderType: query.orderType,
        createdAt,
      },
      include: this.listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async get(merchantId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, merchantId },
      include: this.detailInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async createTableOrder(
    merchantId: bigint,
    staffId: bigint,
    tableId: bigint,
    dto: CreateTableOrderDto,
  ) {
    const normalizedItems = this.normalizeCreateItems(dto);
    let result: { orderId: bigint; sessionId: bigint };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const creator = await this.creatorInvariant.assertValid(tx, {
          merchantId,
          userId: null,
          createdByStaffId: staffId,
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
          return { orderId: duplicate.id, sessionId: duplicate.tableSessionId };
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

        const sessionRows = await tx.$queryRaw<
          Array<{ id: bigint; table_id: bigint }>
        >`
          SELECT id, table_id
          FROM table_sessions
          WHERE merchant_id = ${merchantId}
            AND table_id = ${tableId}
            AND status = 'OPEN'
            AND open_table_id = ${tableId}
          ORDER BY opened_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `;
        const session = sessionRows[0];
        if (!session) {
          throw new ConflictException({
            code: 'TABLE_SESSION_NOT_OPEN',
            message: '该桌当前没有用餐中的桌账，不能点菜',
          });
        }

        const productIds = [
          ...new Set(normalizedItems.map(({ productId }) => productId)),
        ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const products = await tx.$queryRaw<LockedProductRow[]>(Prisma.sql`
          SELECT p.id, p.name_zh, p.image_url, p.price_vnd,
                 p.product_type, p.status, c.is_active AS category_active
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
                  toStatus: 'PENDING_ACCEPTANCE',
                  operatorType: OperatorType.MERCHANT_STAFF,
                  operatorStaffId: staffId,
                  remark: '商家员工创建追加订单',
                },
                {
                  fromStatus: 'PENDING_ACCEPTANCE',
                  toStatus: 'PENDING_ACCEPTANCE',
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
                  remark: '商家点菜创建追加订单',
                },
              ],
            },
          },
          select: { id: true, tableSessionId: true },
        });
        return { orderId: created.id, sessionId: created.tableSessionId! };
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
      result = { orderId: duplicate.id, sessionId: duplicate.tableSessionId };
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
  ) {
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, merchantId },
        select: { id: true, status: true, orderType: true },
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
    return transitioned.order;
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

      const expectedAction =
        input.kind === 'DECREASE'
          ? 'ORDER_ITEM_DECREASED'
          : 'ORDER_ITEM_RETURNED';
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

      const orderRows = await tx.$queryRaw<LockedOrderRow[]>`
        SELECT id, status, order_type, table_id, table_session_id,
               item_amount_vnd, delivery_fee_vnd, total_amount_vnd
        FROM orders
        WHERE id = ${orderId} AND merchant_id = ${merchantId}
        FOR UPDATE
      `;
      const order = orderRows[0];
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

      // Lock every current item in deterministic order. This avoids stale
      // snapshot count/aggregate reads after a concurrent request waited on the
      // order lock under MySQL REPEATABLE READ.
      const itemRows = await tx.$queryRaw<LockedOrderItemRow[]>`
        SELECT id, product_id, product_name_zh_snapshot, unit_price_vnd,
               quantity, subtotal_vnd
        FROM order_items
        WHERE order_id = ${orderId}
        ORDER BY id
        FOR UPDATE
      `;
      const item = itemRows.find(({ id }) => id === itemId);
      if (!item) {
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

      const otherItemCount = itemRows.length - 1;
      if (
        input.kind === 'RETURN' &&
        input.targetQuantity === 0 &&
        otherItemCount === 0
      ) {
        throw new ConflictException({
          code: 'LAST_ORDER_ITEM_RETURN_NOT_ALLOWED',
          message: '该订单仅剩此菜品，暂不能整单退菜',
        });
      }

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

      const afterOrderItemAmountVnd = itemRows.reduce((sum, current) => {
        if (current.id === itemId) {
          return sum + afterItemAmountVnd;
        }
        return sum + current.subtotal_vnd;
      }, 0n);
      const afterOrderAmountVnd =
        afterOrderItemAmountVnd + order.delivery_fee_vnd;
      const cancelEmptyPendingOrder =
        input.kind === 'DECREASE' &&
        input.targetQuantity === 0 &&
        otherItemCount === 0;

      if (!cancelEmptyPendingOrder) {
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
            actorId: staffId.toString(),
            actorRole: creator.staffRole,
          },
          remark:
            input.kind === 'DECREASE' ? '商家减少未接单菜品' : '商家退菜',
        },
      });

      if (cancelEmptyPendingOrder) {
        await this.pendingCancellation.cancel(tx, {
          orderId,
          merchantId,
          operatorStaffId: staffId,
          reason: '商家将未接单订单全部减为零，订单已取消',
          itemAmountVnd: afterOrderItemAmountVnd,
          totalAmountVnd: afterOrderAmountVnd,
        });
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

  private async buildMutationResponse(
    merchantId: bigint,
    orderId: bigint,
    sessionId: bigint,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await this.requireOrder(tx, merchantId, orderId);
        const sessionResult = await this.tableSessions.getSessionDetailWithClient(
          tx,
          merchantId,
          sessionId,
        );
        return { order, session: sessionResult.session };
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
      return this.requireOrder(tx, merchantId, id);
    });
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

  private dateRange(date: string): Prisma.DateTimeFilter {
    const start = new Date(`${date}T00:00:00+07:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { gte: start, lt: end };
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
    },
    statusLogs: {
      include: {
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
