import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MerchantCapabilitiesService } from '../merchant-capabilities/merchant-capabilities.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartContextQueryDto } from './dto/cart-context-query.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

type DbClient = PrismaService | Prisma.TransactionClient;

export interface ResolvedCartContext {
  merchantId: bigint;
  orderType: OrderType;
  tableId: bigint | null;
  tableToken?: string;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantCapabilities: MerchantCapabilitiesService,
  ) {}

  async get(userId: bigint, query: CartContextQueryDto) {
    const context = await this.resolveContext(this.prisma, query);
    const cart = await this.findActiveCart(this.prisma, userId, context);
    return cart ? this.loadCart(this.prisma, cart.id) : this.emptyCart(context);
  }

  async addItem(userId: bigint, dto: AddCartItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.resolveContext(tx, dto);
      const product = await tx.product.findFirst({
        where: {
          id: BigInt(dto.productId),
          merchantId: context.merchantId,
          productType: 'FOOD',
          status: 'ON_SALE',
          category: { isActive: true },
        },
      });
      if (!product) {
        throw new BadRequestException('菜品不可购买或已售罄');
      }

      const cart = await this.getOrCreateActiveCart(tx, userId, context);
      const existing = await tx.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId: product.id,
          remark: dto.remark,
        },
      });
      const nextQuantity = (existing?.quantity ?? 0) + dto.quantity;
      if (nextQuantity > 99) {
        throw new BadRequestException('单个菜品数量不能超过 99');
      }
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: nextQuantity },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId: product.id,
            quantity: dto.quantity,
            remark: dto.remark,
          },
        });
      }
      return this.loadCart(tx, cart.id);
    });
  }

  async updateItem(userId: bigint, itemId: bigint, dto: UpdateCartItemDto) {
    const item = await this.prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { userId, status: 'ACTIVE' },
      },
      include: { cart: true },
    });
    if (!item) throw new NotFoundException('购物车菜品不存在');

    if (dto.remark !== undefined && dto.remark !== item.remark) {
      const duplicate = await this.prisma.cartItem.findFirst({
        where: {
          cartId: item.cartId,
          productId: item.productId,
          remark: dto.remark,
          id: { not: item.id },
        },
      });
      if (duplicate) throw new ConflictException('相同备注的菜品已存在');
    }

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: dto,
    });
    return this.loadCart(this.prisma, item.cartId);
  }

  async deleteItem(userId: bigint, itemId: bigint) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId, status: 'ACTIVE' } },
    });
    if (!item) throw new NotFoundException('购物车菜品不存在');
    await this.prisma.cartItem.delete({ where: { id: item.id } });
    return this.loadCart(this.prisma, item.cartId);
  }

  async clear(userId: bigint, query: CartContextQueryDto) {
    const context = await this.resolveContext(this.prisma, query);
    const cart = await this.findActiveCart(this.prisma, userId, context);
    if (!cart) return this.emptyCart(context);
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { status: 'ABANDONED' },
    });
    return this.emptyCart(context);
  }

  async resolveContext(client: DbClient, input: CartContextQueryDto | AddCartItemDto) {
    const merchantId = BigInt(input.merchantId);
    const merchant = await client.merchant.findFirst({
      where: {
        id: merchantId,
        status: 'ACTIVE',
        merchantType: 'RESTAURANT',
      },
    });
    if (!merchant) throw new BadRequestException('商家当前不可用');

    if (input.orderType === 'DINE_IN') {
      if (!input.tableToken) {
        throw new BadRequestException('堂食必须提供有效桌码');
      }
      const table = await client.diningTable.findUnique({
        where: { qrToken: input.tableToken },
      });
      if (
        !table ||
        table.merchantId !== merchantId ||
        table.status !== 'ACTIVE'
      ) {
        throw new BadRequestException('桌码无效、已停用或已换码');
      }
      if (!merchant.dineInEnabled) {
        throw new BadRequestException('商家当前未开启堂食');
      }
      return {
        merchantId,
        orderType: input.orderType,
        tableId: table.id,
        tableToken: input.tableToken,
      };
    }

    if (input.tableToken) {
      throw new BadRequestException('非堂食购物车不能绑定桌码');
    }
    const capabilities = await this.merchantCapabilities.resolveMerchantCapabilities(
      merchant.id,
    );
    if (input.orderType === 'PICKUP' && !capabilities.pickupEnabled) {
      throw new BadRequestException('商家当前未开启到店自取');
    }
    if (input.orderType === 'DELIVERY' && !capabilities.deliveryEnabled) {
      throw new BadRequestException('商家当前未开启配送');
    }
    return { merchantId, orderType: input.orderType, tableId: null };
  }

  async findActiveCart(
    client: DbClient,
    userId: bigint,
    context: ResolvedCartContext,
  ) {
    const cart = await client.cart.findFirst({
      where: {
        userId,
        merchantId: context.merchantId,
        orderType: context.orderType,
        tableId: context.tableId,
        status: 'ACTIVE',
      },
      orderBy: { id: 'desc' },
    });
    if (cart && cart.expiresAt <= new Date()) {
      await client.cart.update({
        where: { id: cart.id },
        data: { status: 'ABANDONED' },
      });
      return null;
    }
    return cart;
  }

  async loadCart(client: DbClient, cartId: bigint) {
    const cart = await client.cart.findUnique({
      where: { id: cartId },
      include: {
        merchant: {
          select: { id: true, nameZh: true },
        },
        table: {
          select: { id: true, tableNo: true, tableName: true, qrToken: true },
        },
        items: {
          include: {
            product: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!cart) throw new NotFoundException('购物车不存在');
    const itemAmountVnd = cart.items.reduce(
      (sum, item) => sum + item.product.priceVnd * BigInt(item.quantity),
      0n,
    );
    return {
      ...cart,
      itemAmountVnd,
      totalQuantity: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  private async getOrCreateActiveCart(
    tx: Prisma.TransactionClient,
    userId: bigint,
    context: ResolvedCartContext,
  ) {
    const existing = await this.findActiveCart(tx, userId, context);
    if (existing) return existing;
    return tx.cart.create({
      data: {
        userId,
        merchantId: context.merchantId,
        tableId: context.tableId,
        orderType: context.orderType,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  private emptyCart(context: ResolvedCartContext) {
    return {
      id: null,
      merchantId: context.merchantId,
      tableId: context.tableId,
      orderType: context.orderType,
      items: [],
      itemAmountVnd: 0n,
      totalQuantity: 0,
    };
  }
}
