import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { distanceKm, isMerchantOpen } from '../../common/utils/merchant-hours';
import { PrismaService } from '../../database/prisma.service';
import { CartService } from '../cart/cart.service';
import { OrderRequestDto } from './dto/order-request.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  async preview(userId: bigint, dto: OrderRequestDto) {
    return this.prisma.$transaction((tx) =>
      this.validateAndPrice(tx, userId, dto),
    );
  }

  async create(userId: bigint, idempotencyKey: string, dto: OrderRequestDto) {
    this.validateIdempotencyKey(idempotencyKey);
    const existing = await this.findByIdempotency(userId, idempotencyKey);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.order.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey },
          },
          include: this.orderInclude,
        });
        if (duplicate) return duplicate;

        const preview = await this.validateAndPrice(tx, userId, dto);
        const order = await tx.order.create({
          data: {
            orderNo: this.generateOrderNo(),
            idempotencyKey,
            userId,
            merchantId: preview.merchant.id,
            tableId: preview.table?.id,
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

        await tx.cart.update({
          where: { id: preview.cartId },
          data: { status: 'CHECKED_OUT' },
        });
        return order;
      });
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
      if (!dto.contactName?.trim() || !dto.contactPhone?.trim()) {
        throw new BadRequestException('请填写联系人和联系电话');
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
    let deliveryFeeVnd = 0n;
    let deliveryRangeVerified = false;

    if (dto.orderType === 'DELIVERY') {
      if (!dto.deliveryAddress?.trim()) {
        throw new BadRequestException('请填写配送地址');
      }
      if (itemAmountVnd < merchant.minimumDeliveryAmountVnd) {
        throw new BadRequestException(
          `未达到配送起送价 ${merchant.minimumDeliveryAmountVnd.toString()} VND`,
        );
      }
      const hasLatitude = dto.deliveryLatitude !== undefined;
      const hasLongitude = dto.deliveryLongitude !== undefined;
      if (hasLatitude !== hasLongitude) {
        throw new BadRequestException('配送经纬度必须同时提供');
      }
      if (hasLatitude && hasLongitude) {
        const deliveryDistanceKm = distanceKm(
          Number(merchant.latitude),
          Number(merchant.longitude),
          dto.deliveryLatitude!,
          dto.deliveryLongitude!,
        );
        if (deliveryDistanceKm > Number(merchant.deliveryRadiusKm)) {
          throw new BadRequestException('配送地址超出商家配送范围');
        }
        deliveryRangeVerified = true;
      }
      deliveryFeeVnd = merchant.deliveryFeeVnd;
    }

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
      deliveryFeeVnd,
      totalAmountVnd: itemAmountVnd + deliveryFeeVnd,
      deliveryRangeVerified,
      requiresPhoneConfirmation:
        dto.orderType === 'DELIVERY' && !deliveryRangeVerified,
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

  private readonly orderInclude = {
    merchant: {
      select: { id: true, nameZh: true },
    },
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    items: true,
    statusLogs: {
      orderBy: { createdAt: 'asc' as const },
    },
  };
}
