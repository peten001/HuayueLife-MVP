import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import { CartService } from '../cart/cart.service';
import { PrintersService } from '../printers/printers.service';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';
import { PrintJobsService } from '../printing/services/print-jobs.service';
import { TableSessionsService } from '../table-sessions/table-sessions.service';
import { OrderRequestDto } from './dto/order-request.dto';

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
    @Optional()
    @Inject(PrintJobsService)
    private readonly printJobs?: PrintJobsService,
  ) {}

  list(userId: bigint) {
    return this.prisma.order.findMany({
      where: { userId },
      include: this.orderListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async get(userId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: this.orderDetailInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
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
    const existing = await this.findByIdempotency(userId, idempotencyKey);
    if (existing) return existing;

    try {
      let shouldAutoPrint = false;
      const order = await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.order.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey },
          },
          include: this.orderInclude,
        });
        if (duplicate) return duplicate;

        const preview = await this.validateAndPrice(tx, userId, dto);
        const tableSession =
          dto.orderType === 'DINE_IN' && preview.table
            ? await this.tableSessionsService.getOrCreateOpenSession(
                tx,
                preview.merchant.id,
                preview.table.id,
              )
            : null;
        const order = await tx.order.create({
          data: {
            orderNo: this.generateOrderNo(),
            idempotencyKey,
            userId,
            merchantId: preview.merchant.id,
            tableId: preview.table?.id,
            tableSessionId: tableSession?.id,
            tableNoSnapshot: preview.table?.tableNo,
            orderType: dto.orderType,
            contactName: dto.orderType === 'DINE_IN' ? undefined : dto.contactName,
            contactPhone:
              dto.orderType === 'DINE_IN' ? undefined : dto.contactPhone,
            deliveryAddress:
              dto.orderType === 'DELIVERY' ? dto.deliveryAddress : undefined,
            deliveryLatitude:
              dto.orderType === 'DELIVERY' ? dto.deliveryLatitude : undefined,
            deliveryLongitude:
              dto.orderType === 'DELIVERY' ? dto.deliveryLongitude : undefined,
            customerRemark: dto.customerRemark,
            itemAmountVnd: preview.itemAmountVnd,
            deliveryFeeVnd: preview.deliveryFeeVnd,
            totalAmountVnd: preview.totalAmountVnd,
            items: {
              create: preview.items.map((item) => ({
                productId: item.product.id,
                productNameZhSnapshot: item.product.nameZh,
                imageUrlSnapshot: item.product.imageUrl,
                unitPriceVnd: item.product.priceVnd,
                quantity: item.quantity,
                subtotalVnd: item.subtotalVnd,
                remark: item.remark || undefined,
              })),
            },
            statusLogs: {
              create: {
                fromStatus: null,
                toStatus: 'PENDING_ACCEPTANCE',
                operatorType: 'USER',
                operatorUserId: userId,
                remark: '用户提交订单',
              },
            },
          },
          include: this.orderInclude,
        });
        shouldAutoPrint = true;

        await tx.cart.update({
          where: { id: preview.cartId },
          data: { status: 'CHECKED_OUT' },
        });
        return order;
      });
      if (shouldAutoPrint && this.printingFlags.legacyPrintingEnabled()) {
        void this.printersService
          .printOrder(order.merchantId, order.id, 'SYSTEM')
          .catch((error) => {
            this.logger.warn(
              `Auto print failed for order ${order.id.toString()}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }
      return order;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.findByIdempotency(userId, idempotencyKey);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  cancel(userId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
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

      const now = new Date();
      const updated = await tx.order.updateMany({
        where: { id, userId, status: 'PENDING_ACCEPTANCE' },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: '用户取消订单',
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }

      await tx.orderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: 'PENDING_ACCEPTANCE',
          toStatus: 'CANCELLED',
          operatorType: 'USER',
          operatorUserId: userId,
          remark: '用户取消订单',
        },
      });
      return this.requireOwnedOrder(tx, userId, id);
    });
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
    return completed.order;
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

  private findByIdempotency(userId: bigint, idempotencyKey: string) {
    return this.prisma.order.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey },
      },
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
      orderBy: { createdAt: 'asc' as const },
    },
  };

  private readonly orderInclude = this.orderDetailInclude;
}
