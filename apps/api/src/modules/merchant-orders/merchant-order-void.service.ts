import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { resolveBusinessDate } from '../../common/utils/merchant-hours';
import { buildMerchantSettlements, MerchantSettlement } from './merchant-settlements';
import { attributeOrderRevenue, businessDateCandidateWhere, completedRevenueTotals, isOrderInBusinessDate, resolveOrderBusinessDate } from './business-day-accounting';
import { ListOrderVoidsDto, VoidOrderDto } from './dto/void-order.dto';

const ACTION = 'MERCHANT_ORDER_VOID';
const include = Prisma.validator<Prisma.OrderInclude>()({
  tableSession: true,
  table: true,
  items: { include: { product: { select: { nameZh: true, nameVi: true, nameEn: true } } }, orderBy: { id: 'asc' } },
  statusLogs: { where: { action: 'TABLE_SESSION_CHECKOUT' }, select: { metadata: true } },
});

export interface OrderVoidPreview {
  target: string;
  version: string;
  settlement: MerchantSettlement;
  affectedOrderIds: string[];
  affectedOrderNos: string[];
  /** Opening/order business-day attribution, never a negative sale on void day. */
  businessDayImpacts: Array<{
    businessDate: string;
    orderCount: number;
    grossAmountVnd: string;
    discountAmountVnd: string;
    roundingAmountVnd: string;
    netSettledAmountVnd: string;
    cashRevenueVnd: string;
    bankTransferRevenueVnd: string;
    unrecordedRevenueVnd: string;
  }>;
  settlementImpact: { businessDate: string; settlementCount: number; revenueVnd: string };
}

export interface OrderVoidRecord extends OrderVoidPreview {
  operationId: string;
  voidedAt: string;
  actor: { id: string; displayName: string };
  reason: VoidOrderDto['reason'];
  note: string | null;
}

function conflict(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ConflictException({ code, message, ...extra });
}

function json<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}

@Injectable()
export class MerchantOrderVoidService {
  constructor(private readonly prisma: PrismaService) {}

  /** Real DB authority, also used for private audit reads. JWT role is not authority. */
  private async owner(tx: Prisma.TransactionClient, merchantId: bigint, staffId: bigint) {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM merchant_staff WHERE id = ${staffId} AND merchant_id = ${merchantId} FOR UPDATE`;
    const staff = await tx.merchantStaff.findFirst({
      where: { id: staffId, merchantId, role: 'OWNER', status: 'ACTIVE', mustChangePassword: false,
        merchant: { status: 'ACTIVE' } },
      select: { id: true, displayName: true, merchant: { select: { businessHours: true } } },
    });
    if (!staff) throw new ForbiddenException({ code: 'VOID_OWNER_REQUIRED', message: 'An active owner account is required' });
    return staff;
  }

  private parse(target: string) {
    const match = /^(session|order):([1-9]\d{0,18})$/.exec(target);
    if (!match) throw new BadRequestException('Invalid void target');
    return { kind: match[1]!, id: BigInt(match[2]!) };
  }

  private async scope(tx: Prisma.TransactionClient, merchantId: bigint, target: string) {
    const { kind, id } = this.parse(target);
    if (kind === 'session') {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM table_sessions WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Table session not found');
      // Lock every child, including cancelled children. No lock/update of dining_tables.
      await tx.$queryRaw`SELECT id FROM orders WHERE table_session_id = ${id} ORDER BY id FOR UPDATE`;
      const session = await tx.tableSession.findUniqueOrThrow({ where: { id } });
      const orders = await tx.order.findMany({ where: { tableSessionId: id }, include, orderBy: { id: 'asc' } });
      if (session.status !== 'CLOSED' || session.openTableId !== null) conflict('VOID_OPEN_SESSION', 'Open table sessions cannot be voided');
      if (!orders.length || orders.some(order => order.merchantId !== merchantId || order.orderType !== 'DINE_IN' || order.tableId !== session.tableId)) {
        conflict('VOID_SCOPE_CONFLICT', 'Session/order ownership or table evidence does not match');
      }
      if (orders.some(order => !['COMPLETED', 'CANCELLED'].includes(order.status))) conflict('VOID_ACTIVE_ORDER', 'Session contains unfinished orders');
      if (orders.some(order => order.voidOperationId !== session.voidOperationId || Boolean(order.voidedAt) !== Boolean(session.voidedAt))) {
        conflict('VOID_SCOPE_CONFLICT', 'Session and child void states disagree');
      }
      return { orders, session };
    }
    const ref = await tx.order.findFirst({ where: { id, merchantId }, select: { tableSessionId: true } });
    if (!ref) throw new NotFoundException('Order not found');
    // A child route may never silently perform a larger destructive operation.
    if (ref.tableSessionId) conflict('VOID_WHOLE_SESSION_REQUIRED', 'Preview the entire table settlement instead', { target: `session:${ref.tableSessionId}` });
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
    const order = await tx.order.findFirstOrThrow({ where: { id, merchantId }, include });
    if (order.tableSessionId || order.orderType === 'DINE_IN') conflict('VOID_SCOPE_CONFLICT', 'Dine-in requires a valid closed table session');
    if (!['COMPLETED', 'CANCELLED'].includes(order.status)) conflict('VOID_ACTIVE_ORDER', 'Only completed or cancelled independent orders can be voided');
    return { orders: [order], session: null };
  }

  private async prior(tx: Prisma.TransactionClient, orderId: bigint): Promise<OrderVoidRecord> {
    const log = await tx.orderStatusLog.findFirst({ where: { orderId, action: ACTION }, orderBy: { id: 'asc' } });
    const metadata = log?.metadata as { snapshot?: unknown } | null;
    if (!metadata?.snapshot) conflict('VOID_AUDIT_MISSING', 'Void audit snapshot is unavailable; manual review is required');
    return metadata.snapshot as OrderVoidRecord;
  }

  private async assertPrintsFinished(tx: Prisma.TransactionClient, merchantId: bigint, orderIds: bigint[], sessionId?: bigint) {
    const scope = { merchantId, OR: [{ orderId: { in: orderIds } }, ...(sessionId ? [{ tableSessionId: sessionId }] : [])] };
    const [job, outbox, legacy] = await Promise.all([
      tx.printJob.findFirst({ where: { merchantId, AND: [{ OR: scope.OR }, { OR: [
        { status: { in: ['PENDING', 'CLAIMED', 'PRINTING', 'RETRY_WAIT'] } },
        // Unknown physical outcome is not equivalent to a finished print.
        { status: 'FAILED', lastErrorCode: 'PRINT_OUTCOME_UNKNOWN' },
      ] as Prisma.PrintJobWhereInput[] }] }, select: { id: true } }),
      tx.printTriggerOutbox.findFirst({ where: { ...scope, status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true } }),
      tx.printLog.findFirst({ where: { merchantId, orderId: { in: orderIds }, status: { in: ['PENDING', 'PRINTING'] } }, select: { id: true } }),
    ]);
    if (job || outbox || legacy) conflict('VOID_PRINT_IN_FLIGHT', 'Printing is unfinished or its outcome is unknown; resolve the print task first');
  }

  private previewData(target: string, scope: Awaited<ReturnType<MerchantOrderVoidService['scope']>>, schedule: unknown): OrderVoidPreview {
    const { orders, session } = scope;
    const settlements = buildMerchantSettlements(orders.map(order => ({ ...order,
      checkoutLogs: order.statusLogs.map(log => log.metadata as Record<string, string>),
    })), at => resolveBusinessDate(schedule, at));
    const settlement = settlements.find(row => row.settlementId === target);
    if (!settlement || settlement.invariantViolations.length || BigInt(settlement.finalReceivableVnd) < 0n ||
      (session && (session.discountAmountVnd < 0n || session.roundingAmountVnd < 0n)) ||
      orders.some(order => order.totalAmountVnd < 0n || order.itemAmountVnd < 0n || order.deliveryFeeVnd < 0n ||
        order.discountAmountVnd < 0n || order.roundingAmountVnd < 0n || order.itemAmountVnd + order.deliveryFeeVnd !== order.totalAmountVnd ||
        order.items.reduce((sum, item) => sum + item.subtotalVnd, 0n) !== order.itemAmountVnd ||
        order.items.some(item => item.quantity < 0 || BigInt(item.quantity) * item.unitPriceVnd !== item.subtotalVnd))) {
      conflict('VOID_AMOUNT_CONFLICT', 'Settlement amount evidence conflicts; review the original records first');
    }
    const completed = orders.filter(order => order.status === 'COMPLETED');
    const attribution = attributeOrderRevenue(completed);
    const dates = [...new Set(orders.map(order => resolveOrderBusinessDate(order, schedule)))].sort();
    const businessDayImpacts = dates.map(businessDate => {
      const totals = completedRevenueTotals(completed.filter(order =>
        resolveOrderBusinessDate(order, schedule) === businessDate), attribution);
      return { businessDate, ...JSON.parse(JSON.stringify(totals, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) } as OrderVoidPreview['businessDayImpacts'][number];
    });
    const version = createHash('sha256').update(JSON.stringify(json({ target, orders, session, schedule }))).digest('hex');
    return { target, version, settlement, affectedOrderIds: orders.map(order => String(order.id)),
      affectedOrderNos: orders.map(order => order.orderNo), businessDayImpacts,
      settlementImpact: { businessDate: settlement.businessDate, settlementCount: completed.length ? 1 : 0,
        revenueVnd: completed.length ? settlement.finalReceivableVnd : '0' } };
  }

  async preview(merchantId: bigint, staffId: bigint, target: string) {
    return this.prisma.$transaction(async tx => {
      const staff = await this.owner(tx, merchantId, staffId);
      const scope = await this.scope(tx, merchantId, target);
      if (scope.orders[0]!.voidedAt) return this.prior(tx, scope.orders[0]!.id);
      await this.assertPrintsFinished(tx, merchantId, scope.orders.map(order => order.id), scope.session?.id);
      const preview = this.previewData(target, scope, staff.merchant.businessHours);
      await this.assertBusinessDayEvidence(tx, preview, staff.merchant.businessHours);
      return preview;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async void(merchantId: bigint, staffId: bigint, target: string, dto: VoidOrderDto): Promise<OrderVoidRecord> {
    if (dto.reason === 'OTHER' && !dto.note?.trim()) throw new BadRequestException({ code: 'VOID_REASON_REQUIRED', message: 'Please describe the reason' });
    return this.prisma.$transaction(async tx => {
      const staff = await this.owner(tx, merchantId, staffId);
      const requestKey = `void:${dto.requestKey}`;
      const previousRequest = await tx.orderStatusLog.findFirst({ where: { requestKey, action: ACTION, order: { merchantId } } });
      if (previousRequest) {
        const record = await this.prior(tx, previousRequest.orderId);
        if (record.target !== target) conflict('VOID_REQUEST_KEY_CONFLICT', 'Request key already belongs to another target');
        return record;
      }
      const scope = await this.scope(tx, merchantId, target);
      if (scope.orders[0]!.voidedAt) return this.prior(tx, scope.orders[0]!.id);
      const preview = this.previewData(target, scope, staff.merchant.businessHours);
      if (preview.version !== dto.version) conflict('VOID_PREVIEW_STALE', 'Order evidence changed; refresh the preview and confirm again');
      await this.assertBusinessDayEvidence(tx, preview, staff.merchant.businessHours);
      await this.assertPrintsFinished(tx, merchantId, scope.orders.map(order => order.id), scope.session?.id);
      const now = new Date();
      const record: OrderVoidRecord = { ...preview, operationId: randomUUID(), voidedAt: now.toISOString(),
        actor: { id: String(staff.id), displayName: staff.displayName }, reason: dto.reason, note: dto.note?.trim() || null };
      const data = { voidedAt: now, voidedByStaffId: staff.id, voidOperationId: record.operationId, voidReason: dto.reason, voidReasonNote: record.note };
      if (scope.session) await tx.tableSession.update({ where: { id: scope.session.id }, data });
      await tx.order.updateMany({ where: { id: { in: scope.orders.map(order => order.id) }, merchantId }, data });
      // Each child carries the same immutable snapshot; one primary log is the archive row.
      await tx.orderStatusLog.createMany({ data: scope.orders.map((order, index) => ({
        orderId: order.id, fromStatus: order.status, toStatus: order.status, operatorType: 'MERCHANT_STAFF',
        operatorStaffId: staff.id, action: ACTION, requestKey,
        metadata: json({ visibility: 'INTERNAL', primary: index === 0, snapshot: record }),
      })) });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  }

  async list(merchantId: bigint, staffId: bigint, query: ListOrderVoidsDto) {
    return this.prisma.$transaction(async tx => {
      await this.owner(tx, merchantId, staffId);
      const where: Prisma.OrderStatusLogWhereInput = {
        action: ACTION, order: { merchantId }, AND: [
          { metadata: { path: '$.primary', equals: true } },
          ...(query.date ? [{ metadata: { path: '$.snapshot.settlement.businessDate', equals: query.date } }] : []),
        ],
      };
      const keyword = query.search?.trim();
      if (keyword) {
        const matches = await tx.order.findMany({ where: { merchantId, voidedAt: { not: null },
          OR: [{ orderNo: { contains: keyword } }, ...(/^[1-9]\d{0,18}$/.test(keyword) ? [{ id: BigInt(keyword) }] : [])] },
          select: { voidOperationId: true }, distinct: ['voidOperationId'] });
        where.order = { merchantId, voidOperationId: { in: matches.flatMap(row => row.voidOperationId ? [row.voidOperationId] : []) } };
      }
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const start = (page - 1) * pageSize;
      // Only primary logs are paginated, never raw child orders; search matches any child.
      const [logs, total] = await Promise.all([
        tx.orderStatusLog.findMany({ where, select: { metadata: true }, orderBy: { id: 'desc' }, skip: start, take: pageSize }),
        tx.orderStatusLog.count({ where }),
      ]);
      const items = logs.map(log => (log.metadata as unknown as { snapshot: OrderVoidRecord }).snapshot);
      return { items, total, page, pageSize, hasMore: start + pageSize < total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** The preview and the actual opening-day report must remove the same whole
   * scope, including cross-day add-ons. Keep failing closed on real mismatches.
   */
  private async assertBusinessDayEvidence(tx: Prisma.TransactionClient, preview: OrderVoidPreview, schedule: unknown) {
    for (const expected of preview.businessDayImpacts) {
      const candidates = await tx.order.findMany({ where: {
        id: { in: preview.affectedOrderIds.map(BigInt) }, status: 'COMPLETED',
        ...businessDateCandidateWhere(schedule, expected.businessDate),
      }, include: { tableSession: true } });
      const actual = completedRevenueTotals(candidates.filter(order => isOrderInBusinessDate(order, schedule, expected.businessDate)), attributeOrderRevenue(candidates));
      if (actual.netSettledAmountVnd.toString() !== expected.netSettledAmountVnd ||
        actual.discountAmountVnd.toString() !== expected.discountAmountVnd ||
        actual.roundingAmountVnd.toString() !== expected.roundingAmountVnd) {
        conflict('VOID_BUSINESS_DAY_CONFLICT', 'Existing cross-business-day adjustment attribution disagrees with the settlement; accounting review is required before voiding');
      }
    }
  }
}
