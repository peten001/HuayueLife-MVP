import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import { CartService } from '../cart/cart.service';
import { CashierPushService } from '../cashier-push/cashier-push.service';
import { MerchantOrdersService } from '../merchant-orders/merchant-orders.service';
import { businessDateSnapshotValue } from '../merchant-orders/business-day-accounting';
import { OrderCreatorInvariantService } from '../orders/order-creator-invariant.service';
import { TableSessionsService } from '../table-sessions/table-sessions.service';
import { CreateDiningReservationDto, ReservationActionDto, ReservationTimeReplyDto } from './reservation.dto';
import { assertReservationKey, parseReservationTime } from './reservation-policy';

type ReservationItem = {
  productId: string; productNameZhSnapshot: string; productNameViSnapshot: string | null;
  productNameEnSnapshot: string | null; imageUrlSnapshot: string | null;
  quantity: number; unitPriceVnd: string; subtotalVnd: string; remark: string;
};
const merchantSelect = {
  id: true, nameZh: true, nameVi: true, nameEn: true, contactPhone: true,
  addressDetail: true, addressZh: true, addressVi: true, addressEn: true,
  latitude: true, longitude: true,
} satisfies Prisma.MerchantSelect;
const diningInclude = {
  merchant: { select: merchantSelect },
  tableSession: { include: { table: true } },
} satisfies Prisma.DiningReservationInclude;
type DiningRow = Prisma.DiningReservationGetPayload<{ include: typeof diningInclude }>;
const pickupInclude = { merchant: { select: merchantSelect }, items: true } satisfies Prisma.OrderInclude;
type PickupRow = Prisma.OrderGetPayload<{ include: typeof pickupInclude }>;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly cart: CartService,
    private readonly tables: TableSessionsService,
    private readonly creators: OrderCreatorInvariantService,
    private readonly merchantOrders: MerchantOrdersService,
    private readonly push: CashierPushService,
  ) {}

  async create(userId: bigint, key: string, dto: CreateDiningReservationDto, retryCount = 0): Promise<ReturnType<ReservationsService['serializeDining']>> {
    this.appConfig.assertOrderingEnabled();
    assertReservationKey(key);
    const existing = await this.prisma.diningReservation.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, include: diningInclude,
    });
    if (existing) return this.serializeDining(existing);
    const scheduledFor = parseReservationTime(dto.scheduledFor);
    try {
      const result = await this.prisma.$transaction(async tx => {
        const merchantId = BigInt(dto.merchantId);
        // This checks enabled services and account ownership, never capacity or business hours.
        const context = await this.cart.resolveContext(tx, {
          merchantId: dto.merchantId, orderType: 'DINE_IN', reservation: true,
        });
        await this.creators.assertValid(tx, { merchantId, userId, createdByStaffId: null });
        let items: ReservationItem[] = [];
        let cartId: bigint | null = null;
        if (dto.withCart) {
          const active = await this.cart.findActiveCart(tx, userId, context);
          if (!active) throw new ConflictException('预选菜购物车已失效，请重新选菜');
          await tx.$queryRaw`SELECT id FROM carts WHERE id = ${active.id} AND status = 'ACTIVE' FOR UPDATE`;
          const loaded = await tx.cart.findFirst({
            where: { id: active.id, status: 'ACTIVE' },
            include: { items: { include: { product: { include: { category: true } } } } },
          });
          if (!loaded?.items.length) throw new ConflictException('预选菜购物车为空，请重新选菜');
          items = loaded.items.map(item => {
            const p = item.product;
            if (p.merchantId !== merchantId || p.status !== 'ON_SALE' || p.deletedAt || p.productType !== 'FOOD' || !p.category.isActive) {
              throw new ConflictException('预选菜已售罄或下架，请重新选菜');
            }
            return { productId: p.id.toString(), productNameZhSnapshot: p.nameZh,
              productNameViSnapshot: p.nameVi, productNameEnSnapshot: p.nameEn,
              imageUrlSnapshot: p.imageUrl, quantity: item.quantity, unitPriceVnd: p.priceVnd.toString(),
              subtotalVnd: (p.priceVnd * BigInt(item.quantity)).toString(), remark: item.remark };
          });
          cartId = loaded.id;
        }
        const amount = items.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n);
        if (dto.withCart && (dto.expectedAmountVnd === undefined || BigInt(dto.expectedAmountVnd) !== amount)) {
          throw new ConflictException('预选菜价格已变化，请刷新后重新确认');
        }
        const now = new Date();
        const reservation = await tx.diningReservation.create({ data: {
          reservationNo: `YY${Date.now()}${randomBytes(3).toString('hex')}`,
          userId, merchantId, idempotencyKey: key, scheduledFor, guestCount: dto.guestCount,
          contactName: dto.contactName.trim(), contactPhone: dto.contactPhone.trim(),
          customerRemark: dto.customerRemark?.trim(), items, itemAmountVnd: amount,
          audit: [{ action: 'CREATED', at: now.toISOString(), userId: userId.toString() }],
        }, include: diningInclude });
        if (cartId) await tx.cart.update({ where: { id: cartId }, data: { status: 'CHECKED_OUT' } });
        await this.push.enqueueReservation(tx, reservation.id);
        return reservation;
      });
      return this.serializeDining(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && retryCount < 2) {
        return this.create(userId, key, dto, retryCount + 1);
      }
      if (error instanceof ConflictException || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        const duplicate = await this.prisma.diningReservation.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, include: diningInclude,
        });
        if (duplicate) return this.serializeDining(duplicate);
      }
      throw error;
    }
  }

  async listUser(userId: bigint) {
    const rows = await this.prisma.diningReservation.findMany({
      where: { userId }, include: diningInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(row => this.serializeDining(row));
  }

  async getUser(userId: bigint, id: bigint) {
    const row = await this.prisma.diningReservation.findFirst({ where: { id, userId }, include: diningInclude });
    if (!row) throw new NotFoundException('预约不存在');
    return this.serializeDining(row);
  }

  async cancelUser(userId: bigint, id: bigint) {
    return this.prisma.$transaction(async tx => {
      await this.lockDining(tx, id);
      const row = await tx.diningReservation.findFirst({ where: { id, userId }, include: diningInclude });
      if (!row) throw new NotFoundException('预约不存在');
      if (row.status === 'CANCELLED') return this.serializeDining(row);
      if (row.status !== 'PENDING') throw new ConflictException('预约已确认，如需取消请联系商家');
      const updated = await tx.diningReservation.update({ where: { id }, data: {
        status: 'CANCELLED', cancelledAt: new Date(), cancelReason: '用户取消预约', proposedScheduledFor: null,
        audit: this.audit(row, 'USER_CANCELLED', { userId: userId.toString() }),
      }, include: diningInclude });
      return this.serializeDining(updated);
    });
  }

  async listMerchant(merchantId: bigint) {
    const [dining, pickup] = await Promise.all([
      this.prisma.diningReservation.findMany({ where: { merchantId }, include: diningInclude,
        orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }] }),
      this.prisma.order.findMany({ where: { merchantId, orderType: 'PICKUP', isReservation: true, voidedAt: null },
        include: pickupInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    const reservations = [...dining.map(row => this.serializeDining(row)), ...pickup.map(row => this.serializePickup(row))]
      .sort((a, b) => new Date(a.scheduledFor ?? a.createdAt).getTime() - new Date(b.scheduledFor ?? b.createdAt).getTime());
    return { reservations, serverTime: new Date().toISOString() };
  }

  async merchantAction(merchantId: bigint, staffId: bigint, kind: 'DINE_IN' | 'PICKUP', id: bigint, dto: ReservationActionDto) {
    if (kind === 'PICKUP' && dto.action !== 'PROPOSE_TIME') {
      const row = await this.prisma.order.findFirst({
        where: { id, merchantId, orderType: 'PICKUP', isReservation: true, voidedAt: null }, include: pickupInclude,
      });
      if (!row) throw new NotFoundException('预约不存在');
      if (dto.action !== 'CONFIRM' && dto.action !== 'CANCEL') throw new BadRequestException('自取预约请在自取订单中处理制作与交付');
      if (dto.action === 'CONFIRM' && row.status === 'CANCELLED') throw new ConflictException('预约状态已变化，请刷新后重试');
      if ((dto.action === 'CONFIRM' && row.status !== 'PENDING_ACCEPTANCE')
        || (dto.action === 'CANCEL' && row.status === 'CANCELLED')) return this.serializePickup(row);
      await this.merchantOrders.transition(merchantId, staffId, id, dto.action === 'CONFIRM' ? 'ACCEPT' : 'REJECT', dto.reason);
      return this.serializePickup(await this.prisma.order.findUniqueOrThrow({ where: { id }, include: pickupInclude }));
    }
    if (dto.action === 'PROPOSE_TIME') return this.proposeTime(merchantId, staffId, kind, id, dto);
    if (dto.action === 'SEAT') return this.seat(merchantId, staffId, id, dto.tableId);
    return this.prisma.$transaction(async tx => {
      await this.lockDining(tx, id);
      const row = await tx.diningReservation.findFirst({ where: { id, merchantId }, include: diningInclude });
      if (!row) throw new NotFoundException('预约不存在');
      const target = dto.action === 'CONFIRM' ? 'CONFIRMED' : dto.action === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED';
      if (row.status === target) return this.serializeDining(row);
      if (dto.action === 'CONFIRM' && row.proposedScheduledFor) {
        throw new ConflictException('预约时间变更待用户确认，请先联系用户处理');
      }
      if (dto.action === 'CONFIRM' ? row.status !== 'PENDING'
        : !['PENDING', 'CONFIRMED'].includes(row.status) || (dto.action === 'NO_SHOW' && row.status !== 'CONFIRMED')) {
        throw new ConflictException('预约状态已变化，请刷新后重试');
      }
      if (dto.action === 'NO_SHOW' && row.scheduledFor > new Date()) throw new ConflictException('预约时间尚未到，不能标记未到店');
      return this.serializeDining(await tx.diningReservation.update({ where: { id }, data: {
        status: target, confirmedAt: target === 'CONFIRMED' ? new Date() : undefined,
        cancelledAt: target === 'CANCELLED' ? new Date() : undefined,
        cancelReason: target === 'CANCELLED' ? dto.reason?.trim() || '商家取消预约' : undefined,
        proposedScheduledFor: null, audit: this.audit(row, dto.action, { staffId: staffId.toString(), reason: dto.reason ?? '' }),
      }, include: diningInclude }));
    });
  }

  async replyTime(userId: bigint, kind: 'DINE_IN' | 'PICKUP', id: bigint, dto: ReservationTimeReplyDto) {
    return this.prisma.$transaction(async tx => {
      if (kind === 'PICKUP') {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
        const row = await tx.order.findFirst({ where: { id, userId, orderType: 'PICKUP', isReservation: true, voidedAt: null }, include: pickupInclude });
        if (!row) throw new NotFoundException('预约不存在');
        this.assertTimeReply(row.proposedScheduledFor, dto, ['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(row.status));
        const scheduledFor = dto.accept ? parseReservationTime(dto.proposedScheduledFor) : row.scheduledFor;
        const updated = await tx.order.update({ where: { id }, data: { scheduledFor, proposedScheduledFor: null }, include: pickupInclude });
        await tx.orderStatusLog.create({ data: { orderId: id, fromStatus: row.status, toStatus: row.status,
          operatorType: 'USER', operatorUserId: userId, action: dto.accept ? 'RESERVATION_TIME_ACCEPTED' : 'RESERVATION_TIME_DECLINED',
          metadata: { proposedScheduledFor: dto.proposedScheduledFor }, remark: dto.accept ? '用户同意调整预约时间' : '用户保留原预约时间' } });
        return this.serializePickup(updated);
      }
      await this.lockDining(tx, id);
      const row = await tx.diningReservation.findFirst({ where: { id, userId }, include: diningInclude });
      if (!row) throw new NotFoundException('预约不存在');
      this.assertTimeReply(row.proposedScheduledFor, dto, ['PENDING', 'CONFIRMED'].includes(row.status));
      return this.serializeDining(await tx.diningReservation.update({ where: { id }, data: {
        scheduledFor: dto.accept ? parseReservationTime(dto.proposedScheduledFor) : row.scheduledFor,
        proposedScheduledFor: null,
        audit: this.audit(row, dto.accept ? 'TIME_ACCEPTED' : 'TIME_DECLINED', { userId: userId.toString(), proposedScheduledFor: dto.proposedScheduledFor }),
      }, include: diningInclude }));
    });
  }

  private async proposeTime(merchantId: bigint, staffId: bigint, kind: 'DINE_IN' | 'PICKUP', id: bigint, dto: ReservationActionDto) {
    if (!dto.scheduledFor) throw new BadRequestException('请选择新的预约时间');
    const proposedScheduledFor = parseReservationTime(dto.scheduledFor);
    return this.prisma.$transaction(async tx => {
      if (kind === 'PICKUP') {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
        const row = await tx.order.findFirst({ where: { id, merchantId, orderType: 'PICKUP', isReservation: true, voidedAt: null }, include: pickupInclude });
        if (!row) throw new NotFoundException('预约不存在');
        if (!['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(row.status)) throw new ConflictException('订单已开始制作，不能调整预约时间');
        const updated = await tx.order.update({ where: { id }, data: { proposedScheduledFor }, include: pickupInclude });
        await tx.orderStatusLog.create({ data: { orderId: id, fromStatus: row.status, toStatus: row.status,
          operatorType: 'MERCHANT_STAFF', operatorStaffId: staffId, action: 'RESERVATION_TIME_PROPOSED',
          metadata: { proposedScheduledFor: proposedScheduledFor.toISOString() }, remark: '商家提出调整预约时间，等待用户确认' } });
        return this.serializePickup(updated);
      }
      await this.lockDining(tx, id);
      const row = await tx.diningReservation.findFirst({ where: { id, merchantId }, include: diningInclude });
      if (!row) throw new NotFoundException('预约不存在');
      if (!['PENDING', 'CONFIRMED'].includes(row.status)) throw new ConflictException('预约状态已变化，请刷新后重试');
      return this.serializeDining(await tx.diningReservation.update({ where: { id }, data: {
        proposedScheduledFor, audit: this.audit(row, 'TIME_PROPOSED', { staffId: staffId.toString(), proposedScheduledFor: proposedScheduledFor.toISOString() }),
      }, include: diningInclude }));
    });
  }

  private async seat(merchantId: bigint, staffId: bigint, id: bigint, targetTableId?: string) {
    if (!targetTableId) throw new BadRequestException('请选择入座桌台');
    const tableId = BigInt(targetTableId);
    return this.prisma.$transaction(async tx => {
      // Match canonical writers: table -> session -> orders. Lock the reservation after the table.
      await tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ${tableId} AND merchant_id = ${merchantId} FOR UPDATE`;
      await this.lockDining(tx, id);
      const row = await tx.diningReservation.findFirst({ where: { id, merchantId }, include: diningInclude });
      if (!row) throw new NotFoundException('预约不存在');
      if (row.status === 'SEATED' && row.tableSession?.tableId === tableId) return this.serializeDining(row);
      if (row.status !== 'CONFIRMED') throw new ConflictException('请先确认预约，再安排入座');
      if (row.proposedScheduledFor) throw new ConflictException('预约时间变更待用户确认，请先联系用户处理');
      const table = await tx.diningTable.findFirst({ where: { id: tableId, merchantId, status: 'ACTIVE' } });
      if (!table) throw new BadRequestException('桌台不存在或已停用');
      const items = row.items as ReservationItem[];
      if (items.length) {
        const products = await tx.product.findMany({ where: { id: { in: items.map(item => BigInt(item.productId)) }, merchantId }, include: { category: true } });
        if (items.some(item => {
          const p = products.find(product => product.id.toString() === item.productId);
          return !p || p.deletedAt || p.productType !== 'FOOD' || p.status !== 'ON_SALE' || !p.category.isActive || p.priceVnd.toString() !== item.unitPriceVnd;
        })) throw new ConflictException('预选菜价格或供应状态已变化，请与顾客重新确认后预约');
      }
      await this.creators.assertValid(tx, { merchantId, userId: row.userId, createdByStaffId: null });
      const session = await this.tables.getOrCreateOpenSession(tx, merchantId, tableId);
      if (!session.created) throw new ConflictException('该桌已有用餐桌账，请选择空闲桌台');
      let orderId: bigint | null = null;
      if (items.length) {
        const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { businessHours: true } });
        const now = new Date();
        const order = await tx.order.create({ data: {
          orderNo: `HY${Date.now()}${randomBytes(3).toString('hex')}`,
          idempotencyKey: `reservation-${id}`, userId: row.userId, merchantId,
          tableId, tableSessionId: session.id, tableNoSnapshot: table.tableNo,
          orderType: 'DINE_IN', status: 'ACCEPTED', acceptedAt: now,
          contactName: row.contactName, contactPhone: row.contactPhone, customerRemark: row.customerRemark,
          itemAmountVnd: row.itemAmountVnd, totalAmountVnd: row.itemAmountVnd, deliveryFeeVnd: 0n,
          businessDate: businessDateSnapshotValue(merchant.businessHours, now),
          items: { create: items.map(item => ({ productId: BigInt(item.productId),
            productNameZhSnapshot: item.productNameZhSnapshot, imageUrlSnapshot: item.imageUrlSnapshot,
            unitPriceVnd: BigInt(item.unitPriceVnd), subtotalVnd: BigInt(item.subtotalVnd), quantity: item.quantity, remark: item.remark })) },
          statusLogs: { create: { fromStatus: null, toStatus: 'ACCEPTED', operatorType: 'MERCHANT_STAFF',
            operatorStaffId: staffId, action: 'RESERVATION_SEATED', remark: '预约顾客已到店，预选菜确认加入桌账',
            metadata: { reservationId: id.toString(), tableSessionId: session.id.toString() } } },
        }, select: { id: true } });
        orderId = order.id;
      }
      return this.serializeDining(await tx.diningReservation.update({ where: { id }, data: {
        status: 'SEATED', seatedAt: new Date(), tableSessionId: session.id, orderId,
        audit: this.audit(row, 'SEATED', { staffId: staffId.toString(), tableId: targetTableId, tableSessionId: session.id.toString() }),
      }, include: diningInclude }));
    });
  }

  private assertTimeReply(proposed: Date | null, dto: ReservationTimeReplyDto, editable: boolean) {
    if (!editable || !proposed || proposed.toISOString() !== new Date(dto.proposedScheduledFor).toISOString()) {
      throw new ConflictException('预约变更已更新，请刷新后重新确认');
    }
  }

  private lockDining(tx: Prisma.TransactionClient, id: bigint) {
    return tx.$queryRaw`SELECT id FROM dining_reservations WHERE id = ${id} FOR UPDATE`;
  }

  private audit(row: { audit: Prisma.JsonValue }, action: string, fields: Record<string, string> = {}): Prisma.InputJsonArray {
    return [...(row.audit as Prisma.InputJsonArray), { action, at: new Date().toISOString(), ...fields }];
  }

  private serializeDining(row: DiningRow) {
    return { ...row, kind: 'DINE_IN' as const,
      status: row.tableSession?.voidedAt ? 'CANCELLED' : row.status === 'SEATED' && row.tableSession?.status === 'CLOSED' ? 'COMPLETED' : row.status,
      table: row.status === 'SEATED' && row.tableSession ? {
        id: row.tableSession.tableId, tableNo: row.tableSession.table.tableNo,
        tableName: row.tableSession.table.tableName,
        qrToken: row.tableSession.status === 'OPEN' && !row.tableSession.voidedAt ? row.tableSession.table.qrToken : undefined,
      } : null,
      // The full table session is internal and must not expose other customers' orders.
      tableSession: undefined,
    };
  }

  private serializePickup(row: PickupRow) {
    return { ...row, kind: 'PICKUP' as const, reservationNo: row.orderNo, guestCount: null,
      orderId: row.id, table: null,
      status: row.status === 'PENDING_ACCEPTANCE' ? 'PENDING'
        : row.status === 'ACCEPTED' ? 'CONFIRMED' : row.status,
    };
  }
}
