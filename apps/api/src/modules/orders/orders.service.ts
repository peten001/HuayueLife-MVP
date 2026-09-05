import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { PrismaService } from '../../database/prisma.service';
import { businessDateSnapshotValue } from '../merchant-orders/business-day-accounting';
import { AppConfigService } from '../app-config/app-config.service';
import { CartService } from '../cart/cart.service';
import { PrintersService } from '../printers/printers.service';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';
import { PrintJobsService } from '../printing/services/print-jobs.service';
import { TableSessionsService } from '../table-sessions/table-sessions.service';
import { OrderRequestDto } from './dto/order-request.dto';
import { withPickupFulfillmentFields } from './order-fulfillment-fields';
import { OrderCreatorInvariantService } from './order-creator-invariant.service';
import { PendingOrderCancellationService } from './pending-order-cancellation.service';
import {
  isInternalOrderStatusLogAction,
  toCustomerVisibleOrderStatusLogs,
} from './order-status-log-visibility';

const REUSABLE_DINE_IN_CUSTOMER_ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'CANCELLED',
]);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly printersService: PrintersService,
    private readonly tableSessionsService: TableSessionsService,
    private readonly appConfig: AppConfigService,
    private readonly printingFlags: PrintingFeatureFlagsService,
    private readonly creatorInvariant: OrderCreatorInvariantService,
    private readonly pendingCancellation: PendingOrderCancellationService,
    @Optional()
    @Inject(PrintJobsService)
    private readonly printJobs?: PrintJobsService,
  ) {}

  async list(userId: bigint) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: this.orderListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return orders.map((order) => this.serializeCustomerOrder(order));
  }

  async get(userId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: this.orderDetailInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.serializeCustomerOrder(order);
  }

  async preview(userId: bigint, dto: OrderRequestDto) {
    this.appConfig.assertOrderingEnabled();
    return this.prisma.$transaction((tx) =>
      this.validateAndPrice(tx, userId, dto),
    );
  }

  async create(userId: bigint, idempotencyKey: string, dto: OrderRequestDto) {
    this.appConfig.assertOrderingEnabled();
    this.validateIdempotencyKey(idempotencyKey);
    const existing = await this.findByIdempotency(
      userId,
      idempotencyKey,
      this.prisma,
      dto.orderType === 'DINE_IN',
    );
    if (existing) return this.serializeCustomerOrder(existing);

    try {
      let shouldAutoPrint = false;
      const order = await retryWriteConflict(() => this.prisma.$transaction(async (tx) => {
        shouldAutoPrint = false;
        const duplicate = await this.findByIdempotency(
          userId,
          idempotencyKey,
          tx,
          dto.orderType === 'DINE_IN',
        );
        if (duplicate) return { order: duplicate, printTriggerIds: [] };

        const preview = await this.validateAndPrice(tx, userId, dto);
        await this.creatorInvariant.assertValid(tx, {
          merchantId: preview.merchant.id,
          userId,
          createdByStaffId: null,
        });
        const tableSession =
          dto.orderType === 'DINE_IN' && preview.table
            ? await this.tableSessionsService.getOrCreateOpenSession(
                tx,
                preview.merchant.id,
                preview.table.id,
              )
            : null;
        const autoAcceptDineIn = dto.orderType === 'DINE_IN';
        const acceptedAt = autoAcceptDineIn ? new Date() : undefined;
        const createdAt = new Date();
        let order;
        if (autoAcceptDineIn && tableSession) {
          const lockedOrders = await tx.$queryRaw<Array<{
            id: bigint;
            status: OrderStatus;
            user_id: bigint | null;
            item_amount_vnd: bigint;
          }>>`
            SELECT id, status, user_id, item_amount_vnd
            FROM orders
            WHERE table_session_id = ${tableSession.id}
              AND merchant_id = ${preview.merchant.id}
              AND order_type = 'DINE_IN'
              AND user_id = ${userId}
            ORDER BY id
            FOR UPDATE
          `;
          const duplicateAfterLock = await this.findByIdempotency(
            userId,
            idempotencyKey,
            tx,
            true,
          );
          if (duplicateAfterLock) {
            return { order: duplicateAfterLock, printTriggerIds: [] };
          }
          const primary = lockedOrders
            .filter((candidate) => candidate.user_id === userId
              && REUSABLE_DINE_IN_CUSTOMER_ORDER_STATUSES.has(candidate.status)
              && (candidate.status !== 'CANCELLED' || candidate.item_amount_vnd === 0n))
            .sort((left, right) => {
              const leftCancelled = left.status === 'CANCELLED' ? 1 : 0;
              const rightCancelled = right.status === 'CANCELLED' ? 1 : 0;
              return leftCancelled - rightCancelled
                || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
            })[0];
          const printDeltaItems = preview.items.map((item) => ({
            productId: item.product.id.toString(),
            productNameSnapshot: item.product.nameZh,
            quantity: item.quantity,
            remark: item.remark ?? null,
            unitPriceVnd: item.product.priceVnd.toString(),
            subtotalVnd: item.subtotalVnd.toString(),
          }));
          if (primary) {
            const restoreToAccepted = primary.status === 'PENDING_ACCEPTANCE'
              || primary.status === 'CANCELLED';
            const currentItems = await tx.orderItem.findMany({
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
            for (const item of preview.items) {
              const remark = item.remark?.trim() ?? '';
              const existing = currentItems.find((candidate) =>
                candidate.productId === item.product.id
                && candidate.unitPriceVnd === item.product.priceVnd
                && (candidate.remark?.trim() ?? '') === remark,
              );
              if (existing) {
                const quantity = existing.quantity + item.quantity;
                await tx.orderItem.update({
                  where: { id: existing.id },
                  data: {
                    quantity,
                    subtotalVnd: item.product.priceVnd * BigInt(quantity),
                  },
                });
                existing.quantity = quantity;
              } else {
                await tx.orderItem.create({
                  data: {
                    orderId: primary.id,
                    productId: item.product.id,
                    productNameZhSnapshot: item.product.nameZh,
                    imageUrlSnapshot: item.product.imageUrl,
                    unitPriceVnd: item.product.priceVnd,
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
            const amount = aggregate._sum.subtotalVnd ?? 0n;
            await tx.order.update({
              where: { id: primary.id },
              data: {
                status: restoreToAccepted ? 'ACCEPTED' : primary.status,
                acceptedAt: restoreToAccepted ? acceptedAt : undefined,
                cancelledAt: primary.status === 'CANCELLED' ? null : undefined,
                cancelReason: primary.status === 'CANCELLED' ? null : undefined,
                itemAmountVnd: amount,
                totalAmountVnd: amount,
              },
            });
            const statusLog = await tx.orderStatusLog.create({
              data: {
                orderId: primary.id,
                fromStatus: primary.status,
                toStatus: restoreToAccepted ? 'ACCEPTED' : primary.status,
                operatorType: 'SYSTEM',
                operatorUserId: userId,
                action: 'DINE_IN_CUSTOMER_ITEMS_ADDED',
                requestKey: idempotencyKey,
                metadata: {
                  tableSessionId: tableSession.id.toString(),
                  userId: userId.toString(),
                  items: printDeltaItems,
                  printDeltaItems,
                  reusedOrder: true,
                  restoredCancelledOrder: primary.status === 'CANCELLED',
                  autoAcceptedPendingOrder: primary.status === 'PENDING_ACCEPTANCE',
                },
                remark: restoreToAccepted
                  ? '堂食顾客恢复原扫码订单并追加菜品'
                  : '堂食顾客追加菜品到当前扫码订单',
              },
            });
            const printTriggers = this.printJobs
              ? await this.printJobs.enqueueAutomaticProductionTriggersForOrderDelta(tx, {
                  merchantId: preview.merchant.id,
                  orderId: primary.id,
                  orderStatusLogId: statusLog.id,
                  orderType: 'DINE_IN',
                  status: 'ACCEPTED',
                  itemDeltas: printDeltaItems,
                })
              : [];
            order = await tx.order.findUniqueOrThrow({
              where: { id: primary.id },
              include: this.orderInclude,
            });
            await tx.cart.update({ where: { id: preview.cartId }, data: { status: 'CHECKED_OUT' } });
            // The outbox snapshot above prints only this append event. The
            // legacy printer path can only render the whole reused Order, so
            // it must stay off or it would reprint historical dishes.
            shouldAutoPrint = false;
            return { order, printTriggerIds: printTriggers.map(({ id }) => id) };
          }
          order = await tx.order.create({
            data: {
              orderNo: this.generateOrderNo(),
              idempotencyKey,
              userId,
              merchantId: preview.merchant.id,
              tableId: preview.table?.id,
              tableSessionId: tableSession.id,
              tableNoSnapshot: preview.table?.tableNo,
              orderType: 'DINE_IN',
              customerRemark: dto.customerRemark,
              itemAmountVnd: preview.itemAmountVnd,
              deliveryFeeVnd: 0n,
              totalAmountVnd: preview.itemAmountVnd,
              businessDate: businessDateSnapshotValue(preview.merchant.businessHours ?? null, createdAt),
              createdAt,
              status: 'ACCEPTED',
              acceptedAt,
              items: { create: preview.items.map((item) => ({
                productId: item.product.id,
                productNameZhSnapshot: item.product.nameZh,
                imageUrlSnapshot: item.product.imageUrl,
                unitPriceVnd: item.product.priceVnd,
                quantity: item.quantity,
                subtotalVnd: item.subtotalVnd,
                remark: item.remark || undefined,
              })) },
              statusLogs: { create: {
                fromStatus: null,
                toStatus: 'ACCEPTED',
                operatorType: 'SYSTEM',
                operatorUserId: userId,
                action: 'DINE_IN_AUTO_ACCEPTED',
                requestKey: idempotencyKey,
                metadata: {
                  tableSessionId: tableSession.id.toString(),
                  userId: userId.toString(),
                  items: printDeltaItems,
                  printDeltaItems,
                  reusedOrder: false,
                },
                remark: '堂食顾客扫码订单自动接单',
              } },
            },
            include: this.orderInclude,
          });
        } else {
          order = await tx.order.create({
            data: {
              orderNo: this.generateOrderNo(), idempotencyKey, userId,
              merchantId: preview.merchant.id, tableId: preview.table?.id,
              tableSessionId: tableSession?.id, tableNoSnapshot: preview.table?.tableNo,
              orderType: dto.orderType,
              contactName: dto.contactName, contactPhone: dto.contactPhone,
              deliveryAddress: dto.orderType === 'DELIVERY' ? dto.deliveryAddress : undefined,
              deliveryLatitude: dto.orderType === 'DELIVERY' ? dto.deliveryLatitude : undefined,
              deliveryLongitude: dto.orderType === 'DELIVERY' ? dto.deliveryLongitude : undefined,
              customerRemark: dto.customerRemark,
              itemAmountVnd: preview.itemAmountVnd,
              deliveryFeeVnd: preview.deliveryFeeVnd,
              totalAmountVnd: preview.totalAmountVnd,
              businessDate: businessDateSnapshotValue(preview.merchant.businessHours ?? null, createdAt),
              createdAt, status: 'PENDING_ACCEPTANCE',
              items: { create: preview.items.map((item) => ({
                productId: item.product.id, productNameZhSnapshot: item.product.nameZh,
                imageUrlSnapshot: item.product.imageUrl, unitPriceVnd: item.product.priceVnd,
                quantity: item.quantity, subtotalVnd: item.subtotalVnd,
                remark: item.remark || undefined,
              })) },
              statusLogs: { create: {
                fromStatus: null, toStatus: 'PENDING_ACCEPTANCE', operatorType: 'USER',
                operatorUserId: userId, remark: '用户提交订单',
              } },
            },
            include: this.orderInclude,
          });
        }
        const printTriggers = autoAcceptDineIn && this.printJobs
          ? await this.printJobs.enqueueAutomaticProductionTriggersForOrderDelta(tx, {
              merchantId: order.merchantId,
              orderId: order.id,
              orderStatusLogId: order.statusLogs[0].id,
              orderType: order.orderType,
              status: 'ACCEPTED',
              itemDeltas: preview.items.map((item) => ({
                productId: item.product.id.toString(),
                quantity: item.quantity,
                remark: item.remark ?? null,
                unitPriceVnd: item.product.priceVnd.toString(),
              })),
            })
          : [];
        shouldAutoPrint = true;

        await tx.cart.update({
          where: { id: preview.cartId },
          data: { status: 'CHECKED_OUT' },
        });
        return {
          order,
          printTriggerIds: printTriggers.map(({ id: triggerId }) => triggerId),
        };
      }));
      if (order.printTriggerIds.length > 0) {
        try {
          await this.printJobs?.processAutomaticTriggerIds(order.printTriggerIds);
        } catch (error) {
          this.logger.warn(
            `Print trigger processing deferred merchant=${order.order.merchantId} order=${order.order.id} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
          );
        }
      }
      if (shouldAutoPrint && this.printingFlags.legacyPrintingEnabled()) {
        void this.printersService
          .printOrder(order.order.merchantId, order.order.id, 'SYSTEM')
          .catch((error) => {
            this.logger.warn(
              `Auto print failed for order ${order.order.id.toString()}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }
      return this.serializeCustomerOrder(order.order);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.findByIdempotency(
          userId,
          idempotencyKey,
          this.prisma,
          dto.orderType === 'DINE_IN',
        );
        if (duplicate) return this.serializeCustomerOrder(duplicate);
      }
      throw error;
    }
  }

  async cancel(userId: bigint, id: bigint) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, userId },
        select: { id: true, status: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.status !== 'PENDING_ACCEPTANCE') {
        throw new ConflictException('商家接单后不能取消订单');
      }

      await this.pendingCancellation.cancel(tx, {
        orderId: id,
        userId,
        operatorUserId: userId,
        reason: '用户取消订单',
      });
      return this.requireOwnedOrder(tx, userId, id);
    });
    return this.serializeCustomerOrder(order);
  }

  async confirmReceived(userId: bigint, id: bigint) {
    const completed = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, userId },
        select: { id: true, merchantId: true, status: true, orderType: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.orderType !== 'DELIVERY') {
        throw new ConflictException('仅商家配送订单可以确认收货');
      }
      if (order.status !== 'DELIVERING') {
        throw new ConflictException('订单配送中才能确认收货');
      }

      const updated = await tx.order.updateMany({
        where: {
          id,
          userId,
          orderType: 'DELIVERY',
          status: 'DELIVERING',
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }

      const statusLog = await tx.orderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: 'DELIVERING',
          toStatus: 'COMPLETED',
          operatorType: 'USER',
          operatorUserId: userId,
          remark: '用户确认收货',
        },
      });
      const printTriggers = this.printJobs
        ? await this.printJobs.enqueueAutomaticTriggersForOrderTransition(tx, {
            merchantId: order.merchantId,
            orderId: id,
            orderStatusLogId: statusLog.id,
            orderType: order.orderType,
            status: 'COMPLETED',
          })
        : [];
      return {
        order: await this.requireOwnedOrder(tx, userId, id),
        printTriggerIds: printTriggers.map(({ id: triggerId }) => triggerId),
      };
    });
    if (completed.printTriggerIds.length > 0) {
      try {
        await this.printJobs?.processAutomaticTriggerIds(completed.printTriggerIds);
      } catch (error) {
        this.logger.warn(
          `Print trigger processing deferred merchant=${completed.order.merchantId} order=${completed.order.id} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }
    return this.serializeCustomerOrder(completed.order);
  }

  private async validateAndPrice(
    tx: Prisma.TransactionClient,
    userId: bigint,
    dto: OrderRequestDto,
  ) {
    const context = await this.cartService.resolveContext(tx, dto);
    const merchant = await tx.merchant.findUnique({
      where: { id: context.merchantId },
    });
    if (!merchant || merchant.status !== 'ACTIVE') {
      throw new BadRequestException('商家当前不可用');
    }
    if (!isMerchantOpen(merchant)) {
      throw new BadRequestException('商家当前不在营业时间');
    }

    const cart = await this.cartService.findActiveCart(tx, userId, context);
    if (!cart) throw new BadRequestException('当前购物车不存在或已失效');
    const loaded = await tx.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: { category: true },
            },
          },
        },
        table: true,
      },
    });
    if (!loaded?.items.length) throw new BadRequestException('购物车为空');

    if (dto.orderType !== 'DINE_IN') {
      if (!dto.contactPhone?.trim()) {
        throw new BadRequestException('请填写联系电话');
      }
    }

    const items = loaded.items.map((item) => {
      if (
        item.product.merchantId !== merchant.id ||
        item.product.productType !== 'FOOD' ||
        item.product.status !== 'ON_SALE' ||
        !item.product.category.isActive
      ) {
        const reason =
          item.product.status === 'SOLD_OUT' ? '已售罄' : '已下架或不可购买';
        throw new ConflictException(`${item.product.nameZh}${reason}`);
      }
      return {
        ...item,
        subtotalVnd: item.product.priceVnd * BigInt(item.quantity),
      };
    });

    const itemAmountVnd = items.reduce(
      (sum, item) => sum + item.subtotalVnd,
      0n,
    );
    const deliveryPricing = this.resolveDeliveryPricing(merchant, dto);
    console.log('[orders] delivery range check', {
      orderType: dto.orderType,
      distanceKm: deliveryPricing.distanceKm,
      deliveryRadiusKm: deliveryPricing.deliveryRadiusKm,
      outOfRange: deliveryPricing.outOfRange,
      allowCreate: true,
    });

    return {
      cartId: loaded.id,
      merchant: {
        id: merchant.id,
        nameZh: merchant.nameZh,
        businessHours: merchant.businessHours,
      },
      table: loaded.table
        ? {
            id: loaded.table.id,
            tableNo: loaded.table.tableNo,
            tableName: loaded.table.tableName,
          }
        : null,
      orderType: dto.orderType,
      items,
      itemAmountVnd,
      deliveryFeeVnd: deliveryPricing.deliveryFeeVnd,
      totalAmountVnd: itemAmountVnd + deliveryPricing.deliveryFeeVnd,
      deliveryRangeVerified: deliveryPricing.deliveryRangeVerified,
      requiresPhoneConfirmation:
        dto.orderType === 'DELIVERY' &&
        !deliveryPricing.deliveryRangeVerified,
  };
}

  private resolveDeliveryPricing(
    merchant: {
      latitude: Prisma.Decimal | number | string;
      longitude: Prisma.Decimal | number | string;
      deliveryRadiusKm: Prisma.Decimal | number | string;
      deliveryFeeVnd: bigint;
    },
    dto: OrderRequestDto,
  ) {
    const deliveryLatitude =
      dto.deliveryLatitude === undefined ? null : Number(dto.deliveryLatitude);
    const deliveryLongitude =
      dto.deliveryLongitude === undefined ? null : Number(dto.deliveryLongitude);
    const deliveryRadiusKm = Number(merchant.deliveryRadiusKm);
    const merchantLatitude = Number(merchant.latitude);
    const merchantLongitude = Number(merchant.longitude);

    if (
      !Number.isFinite(deliveryLatitude) ||
      !Number.isFinite(deliveryLongitude) ||
      !Number.isFinite(merchantLatitude) ||
      !Number.isFinite(merchantLongitude) ||
      !Number.isFinite(deliveryRadiusKm)
    ) {
      return {
        deliveryFeeVnd: 0n,
        deliveryRangeVerified: false,
        outOfRange: false,
        distanceKm: null as number | null,
        deliveryRadiusKm: Number.isFinite(deliveryRadiusKm)
          ? deliveryRadiusKm
          : null,
      };
    }

    const deliveryDistanceKm = distanceKm(
      merchantLatitude,
      merchantLongitude,
      deliveryLatitude as number,
      deliveryLongitude as number,
    );
    const inRange = deliveryDistanceKm <= deliveryRadiusKm;
    return {
      deliveryFeeVnd: inRange ? merchant.deliveryFeeVnd : 0n,
      deliveryRangeVerified: inRange,
      outOfRange: !inRange,
      distanceKm: deliveryDistanceKm,
      deliveryRadiusKm,
    };
  }

  private async findByIdempotency(
    userId: bigint,
    idempotencyKey: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
    includeDineInAppend = false,
  ) {
    const direct = await client.order.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey },
      },
      include: this.orderInclude,
    });
    if (direct) return direct;
    if (!includeDineInAppend) return null;

    // Reused DINE_IN orders keep their original Order.idempotencyKey. Each
    // later cart submission therefore owns its retry identity in the append
    // audit row instead of creating another Order solely for deduplication.
    const append = await client.orderStatusLog.findFirst({
      where: {
        requestKey: idempotencyKey,
        operatorUserId: userId,
        action: { in: ['DINE_IN_AUTO_ACCEPTED', 'DINE_IN_CUSTOMER_ITEMS_ADDED'] },
        order: { userId, orderType: 'DINE_IN' },
      },
      select: { orderId: true },
      orderBy: { id: 'asc' },
    });
    if (!append) return null;
    return client.order.findFirst({
      where: { id: append.orderId, userId },
      include: this.orderInclude,
    });
  }

  private requireOwnedOrder(
    tx: Prisma.TransactionClient,
    userId: bigint,
    id: bigint,
  ) {
    return tx.order.findFirstOrThrow({
      where: { id, userId },
      include: this.orderDetailInclude,
    });
  }

  private validateIdempotencyKey(value: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8-64 URL-safe characters',
      );
    }
  }

  /**
   * Keep the existing miniapp/customer order response contract stable after
   * adding merchant-origin and internal adjustment audit columns. Merchant
   * order endpoints intentionally retain the full fields for cashier audit.
   */
  private serializeCustomerOrder<
    T extends {
      createdByStaffId: bigint | null;
      voidedAt?: Date | null;
      voidedByStaffId?: bigint | null;
      voidReason?: string | null;
      voidReasonNote?: string | null;
      voidOperationId?: string | null;
      orderType: OrderType;
      orderNo: string;
      createdAt: Date;
      readyAt: Date | null;
      statusLogs?: ReadonlyArray<{
        toStatus: string;
        action: string | null;
        metadata: Prisma.JsonValue | null;
        requestKey: string | null;
      }>;
    },
  >(order: T) {
    const {
      createdByStaffId: _createdByStaffId,
      voidedAt: _voidedAt, voidedByStaffId: _voidedByStaffId,
      voidReason: _voidReason, voidReasonNote: _voidReasonNote, voidOperationId: _voidOperationId,
      ...withoutCreator
    } = order;
    if (!order.statusLogs) {
      return withPickupFulfillmentFields(withoutCreator);
    }

    return withPickupFulfillmentFields({
      ...withoutCreator,
      statusLogs: order.orderType === 'DINE_IN'
        ? toCustomerVisibleOrderStatusLogs(order.statusLogs)
        : order.statusLogs
            .filter((log) => !isInternalOrderStatusLogAction(log.action))
            .map((log) => {
              const {
                action: _action,
                metadata: _metadata,
                requestKey: _requestKey,
                ...publicLog
              } = log;
              return publicLog;
            }),
    });
  }

  private generateOrderNo() {
    const timestamp = new Date()
      .toISOString()
      .replace(/\D/g, '')
      .slice(2, 14);
    return `HY${timestamp}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private readonly orderListInclude = {
    merchant: {
      select: { id: true, nameZh: true, logoUrl: true },
    },
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    items: true,
  };

  private readonly orderDetailInclude = {
    ...this.orderListInclude,
    statusLogs: {
      orderBy: [
        { createdAt: 'asc' as const },
        { id: 'asc' as const },
      ],
    },
  };

  private readonly orderInclude = this.orderDetailInclude;
}

async function retryWriteConflict<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034';
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable write-conflict retry state');
}
