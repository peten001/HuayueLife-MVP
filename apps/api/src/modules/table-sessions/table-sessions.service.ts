import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, OrderType, PaymentMethod, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { toMerchantVisibleOrderStatusLog } from '../orders/order-status-log-visibility';
import { PrintJobsService } from '../printing/services/print-jobs.service';
import { resolveBusinessDate } from '../../common/utils/merchant-hours';
import { businessDateSnapshotValue } from '../merchant-orders/business-day-accounting';
import {
  calculateSettlementAdjustment,
  normalizeDiscountPayableRateBps,
} from '../orders/settlement-adjustment';

type DbClient = PrismaService | Prisma.TransactionClient;

type CheckoutOrderRow = {
  id: bigint;
  status: OrderStatus;
  order_type: OrderType;
  total_amount_vnd: bigint;
  item_amount_vnd: bigint;
  business_date: Date | null;
  created_at: Date;
};

type SettlementAdjustmentRequest = {
  discountPayableRateBps: number | null;
  roundingEnabled: boolean;
};

type TransferTableSessionRequest = {
  targetTableId: bigint;
  expectedSourceTableId: bigint;
  requestKey: string;
};

const BILLABLE_ORDER_STATUSES: OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
];

const UNFINISHED_ORDER_STATUSES: OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
];

const OPEN_SESSION_SUMMARY_SELECT = {
  id: true,
  sessionNo: true,
  merchantId: true,
  tableId: true,
  status: true,
  openedAt: true,
  closedAt: true,
  discountPayableRateBps: true,
  discountAmountVnd: true,
  discountAppliedByStaffId: true,
  discountAppliedAt: true,
  roundingAppliedByStaffId: true,
  roundingAmountVnd: true,
  table: {
    select: {
      id: true,
      tableNo: true,
      tableName: true,
    },
  },
  orders: {
    select: {
      status: true,
      createdAt: true,
      totalAmountVnd: true,
      items: { select: { quantity: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.TableSessionSelect;

type OpenSessionSummaryRow = Prisma.TableSessionGetPayload<{
  select: typeof OPEN_SESSION_SUMMARY_SELECT;
}>;

@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly printJobs: PrintJobsService,
  ) {}

  async getOrCreateOpenSession(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ): Promise<{ id: bigint; created: boolean }> {
    await this.lockActiveTableRow(tx, merchantId, tableId);

    const existingId = await this.findOpenSessionId(tx, merchantId, tableId);
    if (existingId) {
      const currentId = await this.confirmOpenSessionIdForUpdate(
        tx,
        merchantId,
        tableId,
        existingId,
      );
      if (currentId) {
        return { id: currentId, created: false };
      }
    }

    try {
      const created = await tx.tableSession.create({
        data: {
          merchantId,
          tableId,
          openTableId: tableId,
          sessionNo: this.generateSessionNo(),
        },
      });
      return { id: created.id, created: true };
    } catch (error) {
      if (!this.isOpenSessionUniqueViolation(error)) {
        throw error;
      }

      const sessionId = await this.findOpenSessionIdForUpdate(
        tx,
        merchantId,
        tableId,
      );
      if (sessionId) {
        return { id: sessionId, created: false };
      }

      throw new InternalServerErrorException({
        code: 'TABLE_SESSION_CREATE_RETRY_FAILED',
        message: '桌台会话创建失败，请稍后重试',
      });
    }
  }

  async getCurrentSession(merchantId: bigint, tableId: bigint) {
    const table = await this.requireOwnedTable(this.prisma, merchantId, tableId);
    const session = await this.prisma.tableSession.findFirst({
      where: { merchantId, tableId, status: 'OPEN' },
      include: this.sessionOrdersInclude,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    });

    return {
      session: session
        ? this.serializeSessionSummary(session, {
            id: table.id,
            tableNo: table.tableNo,
            tableName: table.tableName,
          })
        : null,
    };
  }

  async listOpenSessions(merchantId: bigint) {
    const sessions = await this.prisma.tableSession.findMany({
      where: { merchantId, status: 'OPEN' },
      select: OPEN_SESSION_SUMMARY_SELECT,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    });

    return {
      sessions: sessions.map((session) =>
        this.serializeSessionSummary(session, {
          id: session.table.id,
          tableNo: session.table.tableNo,
          tableName: session.table.tableName,
        }),
      ),
    };
  }

  async getSessionDetail(merchantId: bigint, sessionId: bigint) {
    return this.getSessionDetailWithClient(this.prisma, merchantId, sessionId);
  }

  async transferSession(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
    input: TransferTableSessionRequest,
  ) {
    if (input.targetTableId === input.expectedSourceTableId) {
      throw new BadRequestException({
        code: 'TABLE_TRANSFER_SAME_TABLE',
        message: '目标桌台不能与当前桌台相同',
      });
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const sessionRef = await this.requireOwnedSessionRef(tx, merchantId, sessionId);
      const tableIds = [...new Set([sessionRef.tableId, input.targetTableId])]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      let targetStatus = '';
      for (const tableId of tableIds) {
        const table = await this.lockTableRow(tx, merchantId, tableId);
        if (tableId === input.targetTableId) targetStatus = table.status;
      }
      if (targetStatus !== 'ACTIVE') {
        throw new BadRequestException({
          code: 'TABLE_TRANSFER_TARGET_NOT_AVAILABLE',
          message: '目标桌台当前不可用',
        });
      }

      const session = await this.requireOwnedSessionRowForUpdate(tx, merchantId, sessionId);
      if (session.status !== 'OPEN' || session.open_table_id === null) {
        throw new ConflictException({
          code: 'TABLE_SESSION_NOT_OPEN',
          message: '桌台会话已关闭，无法转台',
        });
      }
      if (session.table_id === input.targetTableId && session.open_table_id === input.targetTableId) {
        return { sourceTableId: input.expectedSourceTableId, targetTableId: input.targetTableId };
      }
      if (
        session.table_id !== input.expectedSourceTableId
        || session.open_table_id !== input.expectedSourceTableId
      ) {
        throw new ConflictException({
          code: 'TABLE_TRANSFER_SOURCE_CHANGED',
          message: '当前桌台已变化，请刷新后重试',
        });
      }

      const occupied = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id
        FROM table_sessions
        WHERE merchant_id = ${merchantId}
          AND open_table_id = ${input.targetTableId}
          AND status = 'OPEN'
          AND id <> ${sessionId}
        FOR UPDATE
      `;
      if (occupied.length > 0) {
        throw new ConflictException({
          code: 'TABLE_TRANSFER_TARGET_OCCUPIED',
          message: '目标桌台已有进行中的账单',
        });
      }

      const sessionOrders = await tx.$queryRaw<Array<{
        id: bigint;
        status: OrderStatus;
      }>>`
        SELECT id, status
        FROM orders
        WHERE merchant_id = ${merchantId}
          AND table_session_id = ${sessionId}
        ORDER BY id
        FOR UPDATE
      `;

      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          tableId: input.targetTableId,
          openTableId: input.targetTableId,
        },
      });
      await tx.order.updateMany({
        where: { merchantId, tableSessionId: sessionId },
        data: { tableId: input.targetTableId },
      });
      if (sessionOrders.length > 0) {
        await tx.orderStatusLog.createMany({
          data: sessionOrders.map((order) => ({
            orderId: order.id,
            fromStatus: order.status,
            toStatus: order.status,
            operatorType: 'MERCHANT_STAFF',
            operatorStaffId: staffId,
            action: 'TABLE_SESSION_TRANSFERRED',
            requestKey: input.requestKey,
            remark: '整桌转台',
            metadata: {
              tableSessionId: sessionId.toString(),
              sourceTableId: input.expectedSourceTableId.toString(),
              targetTableId: input.targetTableId.toString(),
            },
          })),
          skipDuplicates: true,
        });
      }

      return {
        sourceTableId: input.expectedSourceTableId,
        targetTableId: input.targetTableId,
      };
    });

    this.logger.log(
      `Transferred table session ${sessionId.toString()} from ${transfer.sourceTableId.toString()} to ${transfer.targetTableId.toString()} for merchant ${merchantId.toString()}`,
    );
    return this.getSessionDetail(merchantId, sessionId);
  }

  async getSessionDetailWithClient(
    client: DbClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const session = await this.requireOwnedSession(client, merchantId, sessionId);
    return {
      session: this.serializeSessionDetail(session),
    };
  }

  async closeSession(merchantId: bigint, sessionId: bigint) {
    const result = await this.prisma.$transaction(async (tx) => {
      const sessionRef = await this.requireOwnedSessionRef(tx, merchantId, sessionId);
      await this.lockTableRow(tx, merchantId, sessionRef.tableId);

      const session = await this.requireOwnedSessionRowForUpdate(
        tx,
        merchantId,
        sessionId,
      );
      if (session.status === 'CLOSED') {
        return { sessionId };
      }

      // Use a locking/current read after the table and session locks. A normal
      // Prisma count here can retain an older MySQL RR snapshot and miss an
      // add-on order that committed while closeSession waited for the table.
      const sessionOrders = await tx.$queryRaw<Array<{
        id: bigint;
        status: OrderStatus;
      }>>`
        SELECT id, status
        FROM orders
        WHERE table_session_id = ${sessionId}
        ORDER BY id
        FOR UPDATE
      `;
      if (
        sessionOrders.some((order) =>
          UNFINISHED_ORDER_STATUSES.includes(order.status),
        )
      ) {
        throw new ConflictException({
          code: 'TABLE_SESSION_HAS_UNFINISHED_ORDERS',
          message: '该桌仍有未完成订单，无法完成结账。',
        });
      }

      const closedAt = new Date();
      const updated = await tx.tableSession.updateMany({
        where: { id: sessionId, merchantId, status: 'OPEN' },
        data: {
          openTableId: null,
          status: 'CLOSED',
          closedAt,
        },
      });
      if (updated.count === 0) {
        return { sessionId };
      }

      return { sessionId };
    });

    return this.getSessionDetail(merchantId, result.sessionId);
  }

  private async getCheckoutSnapshot(merchantId: bigint, sessionId: bigint) {
    const [detail, orders] = await Promise.all([
      this.getSessionDetail(merchantId, sessionId),
      this.prisma.order.findMany({
        where: { merchantId, tableSessionId: sessionId },
        include: this.checkoutOrderInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      ...detail,
      orders: orders.map((order) => ({
        ...order,
        items: this.serializeLocalizedOrderItems(order.items),
        statusLogs: order.statusLogs.map(toMerchantVisibleOrderStatusLog),
      })),
    };
  }

  async checkoutSession(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
    paymentMethod?: PaymentMethod,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const sessionRef = await this.requireOwnedSessionRef(tx, merchantId, sessionId);
      await this.lockTableRow(tx, merchantId, sessionRef.tableId);

      const session = await this.requireOwnedSessionRowForUpdate(
        tx,
        merchantId,
        sessionId,
      );
      if (session.status === 'CLOSED') {
        return { sessionId, printTriggerIds: [] as bigint[] };
      }
      const merchant = await tx.merchant.findUnique({
        where: { id: merchantId },
        select: { businessHours: true },
      });
      if (!merchant) throw new NotFoundException('Merchant not found');

      // The dining-table lock serializes checkout against new orders. Locking
      // every bound order then makes completion, status logs, and session close
      // one atomic state change for retries and concurrent checkout requests.
      const sessionOrders = await tx.$queryRaw<CheckoutOrderRow[]>`
        SELECT id, status, order_type, item_amount_vnd, total_amount_vnd,
               business_date, created_at
        FROM orders
        WHERE table_session_id = ${sessionId}
        ORDER BY id
        FOR UPDATE
      `;

      if (sessionOrders.some((order) => order.order_type !== 'DINE_IN')) {
        throw new ConflictException({
          code: 'TABLE_SESSION_HAS_NON_DINE_IN_ORDERS',
          message: '桌账包含非堂食订单，无法完成结账。',
        });
      }
      if (sessionOrders.some((order) => order.status === 'PENDING_ACCEPTANCE')) {
        throw new ConflictException({
          code: 'TABLE_SESSION_HAS_UNACCEPTED_ORDERS',
          message: '该桌仍有未接单订单，无法完成结账。',
        });
      }

      const allowedStatuses: OrderStatus[] = [
        'ACCEPTED',
        'PREPARING',
        'READY',
        'COMPLETED',
        'CANCELLED',
      ];
      if (sessionOrders.some((order) => !allowedStatuses.includes(order.status))) {
        throw new ConflictException({
          code: 'TABLE_SESSION_HAS_UNSUPPORTED_ORDER_STATUS',
          message: '桌账包含无法结账的订单状态，请刷新后重试。',
        });
      }

      const itemAmountVnd = sessionOrders
        .filter((order) => BILLABLE_ORDER_STATUSES.includes(order.status))
        .reduce(
          (sum, order) => sum + (order.item_amount_vnd ?? order.total_amount_vnd),
          0n,
        );
      const roundingApplied = session.rounding_applied_by_staff_id !== null;
      const amounts = calculateSettlementAdjustment({
        itemAmountVnd,
        discountPayableRateBps: session.discount_payable_rate_bps ?? null,
        roundingEnabled: roundingApplied,
      });
      const completedAt = new Date();
      const businessDate = resolveBusinessDate(merchant.businessHours, completedAt);
      const businessDateValue = new Date(`${businessDate}T00:00:00.000Z`);
      const printTriggerIds: bigint[] = [];
      for (const order of sessionOrders) {
        if (!['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) continue;
        const orderBusinessDate = order.business_date
          ? undefined
          : businessDateSnapshotValue(merchant.businessHours, order.created_at);

        const updated = await tx.order.updateMany({
          where: {
            id: order.id,
            merchantId,
            tableSessionId: sessionId,
            orderType: 'DINE_IN',
            status: order.status,
          },
          data: {
            status: 'COMPLETED',
            completedAt,
            businessDate: orderBusinessDate,
            paymentMethod,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: 'TABLE_SESSION_ORDER_STATUS_CHANGED',
            message: '桌台订单状态已变化，请刷新后重试。',
          });
        }

        const statusLog = await tx.orderStatusLog.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'COMPLETED',
            operatorType: 'MERCHANT_STAFF',
            operatorStaffId: staffId,
            action: 'TABLE_SESSION_CHECKOUT',
            metadata: {
              tableSessionId: sessionId.toString(),
              originalAmountVnd: itemAmountVnd.toString(),
              itemAmountVnd: itemAmountVnd.toString(),
              discountPayableRateBps: amounts.discountPayableRateBps,
              discountAmountVnd: amounts.discountAmountVnd.toString(),
              afterDiscountAmountVnd: amounts.discountedItemAmountVnd.toString(),
              nonDiscountableFeeVnd: amounts.nonDiscountableFeeVnd.toString(),
              roundingAmountVnd: amounts.roundingAmountVnd.toString(),
              finalPayableAmountVnd: amounts.payableAmountVnd.toString(),
              payableAmountVnd: amounts.payableAmountVnd.toString(),
            },
            remark: '桌台结账，订单自动完成',
          },
        });
        const triggers = await this.printJobs.enqueueAutomaticTriggersForOrderTransition(
          tx,
          {
            merchantId,
            orderId: order.id,
            orderStatusLogId: statusLog.id,
            orderType: 'DINE_IN',
            status: 'COMPLETED',
          },
        );
        printTriggerIds.push(...triggers.map(({ id }) => id));
      }

      const completedWithoutBusinessDate = sessionOrders.filter(
        (order) => order.status === 'COMPLETED' && !order.business_date,
      );
      if (completedWithoutBusinessDate.length > 0) {
        for (const order of completedWithoutBusinessDate) {
          await tx.order.updateMany({
            where: {
              id: order.id,
              merchantId,
              tableSessionId: sessionId,
              status: 'COMPLETED',
            },
            data: {
              businessDate: businessDateSnapshotValue(
                merchant.businessHours,
                order.created_at,
              ),
              paymentMethod,
            },
          });
        }
      }

      const closed = await tx.tableSession.updateMany({
        where: { id: sessionId, merchantId, status: 'OPEN' },
        data: {
          openTableId: null,
          status: 'CLOSED',
          closedAt: completedAt,
          businessDate: businessDateValue,
          paymentMethod,
          discountPayableRateBps: amounts.discountPayableRateBps,
          discountAmountVnd: amounts.discountAmountVnd,
          roundingAmountVnd: amounts.roundingAmountVnd,
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException({
          code: 'TABLE_SESSION_STATUS_CHANGED',
          message: '桌账状态已变化，请刷新后重试。',
        });
      }

      const checkoutTriggers =
        await this.printJobs.enqueueAutomaticTableSessionCheckout(tx, {
          merchantId,
          tableSessionId: sessionId,
        });
      printTriggerIds.push(...checkoutTriggers.map(({ id }) => id));

      return { sessionId, printTriggerIds };
    });

    if (result.printTriggerIds.length > 0) {
      try {
        await this.printJobs.processAutomaticTriggerIds(result.printTriggerIds);
      } catch (error) {
        // The outbox rows were committed with the checkout transaction and can
        // be recovered by the connector even if this immediate attempt fails.
        this.logger.warn(
          `Checkout print trigger processing deferred merchant=${merchantId} session=${sessionId} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }

    return this.getCheckoutSnapshot(merchantId, result.sessionId);
  }

  async setRounding(merchantId: bigint, staffId: bigint, sessionId: bigint, enabled: boolean) {
    return this.updateSettlementAdjustment(
      merchantId,
      staffId,
      sessionId,
      { discountPayableRateBps: undefined, roundingEnabled: enabled },
    );
  }

  async setSettlementAdjustment(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
    input: SettlementAdjustmentRequest,
  ) {
    return this.updateSettlementAdjustment(merchantId, staffId, sessionId, {
      discountPayableRateBps: normalizeDiscountPayableRateBps(
        input.discountPayableRateBps,
      ),
      roundingEnabled: input.roundingEnabled,
    });
  }

  private async updateSettlementAdjustment(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
    input: {
      discountPayableRateBps: number | null | undefined;
      roundingEnabled: boolean;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const sessionRef = await this.requireOwnedSessionRef(tx, merchantId, sessionId);
      await this.lockTableRow(tx, merchantId, sessionRef.tableId);
      const session = await this.requireOwnedSessionRowForUpdate(tx, merchantId, sessionId);
      if (session.status !== 'OPEN') throw new ConflictException({ code: 'TABLE_SESSION_CLOSED', message: '桌账已关闭。' });
      const orders = await tx.$queryRaw<Array<{
        status: OrderStatus;
        order_type: OrderType;
        total_amount_vnd: bigint;
      }>>`
        SELECT status, order_type, total_amount_vnd
        FROM orders
        WHERE table_session_id = ${sessionId}
        ORDER BY id
        FOR UPDATE
      `;
      if (orders.some((order) => order.order_type !== 'DINE_IN')) {
        throw new ConflictException({
          code: 'TABLE_SESSION_HAS_NON_DINE_IN_ORDERS',
          message: '桌账包含非堂食订单，无法抹零。',
        });
      }
      const itemAmountVnd = orders
        .filter((order) => BILLABLE_ORDER_STATUSES.includes(order.status))
        .reduce((sum, order) => sum + order.total_amount_vnd, 0n);
      const discountPayableRateBps = input.discountPayableRateBps === undefined
        ? session.discount_payable_rate_bps ?? null
        : input.discountPayableRateBps;
      const amounts = calculateSettlementAdjustment({
        itemAmountVnd,
        discountPayableRateBps,
        roundingEnabled: input.roundingEnabled,
      });
      const discountChanged =
        amounts.discountPayableRateBps !==
          (session.discount_payable_rate_bps ?? null) ||
        amounts.discountAmountVnd !== (session.discount_amount_vnd ?? 0n);
      const roundingApplied =
        session.rounding_applied_by_staff_id !== null;
      const roundingChanged =
        input.roundingEnabled !== roundingApplied ||
        amounts.roundingAmountVnd !== session.rounding_amount_vnd;
      if (!discountChanged && !roundingChanged) return { sessionId };
      const now = new Date();
      await tx.tableSession.update({
        where: { id: sessionId },
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
              }
            : {}),
        },
      });
      return { sessionId };
    });
    return this.getSessionDetail(merchantId, result.sessionId);
  }

  private async requireOwnedTable(
    client: DbClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    const table = await client.diningTable.findFirst({
      where: { id: tableId, merchantId },
      select: {
        id: true,
        merchantId: true,
        tableNo: true,
        tableName: true,
        status: true,
      },
    });
    if (!table) {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: '桌台不存在',
      });
    }
    return table;
  }

  private async requireOwnedSession(
    client: DbClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const session = await client.tableSession.findFirst({
      where: { id: sessionId, merchantId },
      include: this.sessionOrdersInclude,
    });
    if (!session) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }
    return session;
  }

  private async requireOwnedSessionRowForUpdate(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const rows = await tx.$queryRaw<Array<{
      id: bigint;
      merchant_id: bigint;
      table_id: bigint;
      status: string;
      open_table_id: bigint | null;
      closed_at: Date | null;
      rounding_amount_vnd: bigint;
      rounding_applied_by_staff_id: bigint | null;
      discount_payable_rate_bps: number | null;
      discount_amount_vnd: bigint;
      discount_applied_by_staff_id: bigint | null;
      discount_applied_at: Date | null;
    }>>`
      SELECT id, merchant_id, table_id, status, open_table_id, closed_at,
             rounding_amount_vnd, rounding_applied_by_staff_id,
             discount_payable_rate_bps, discount_amount_vnd,
             discount_applied_by_staff_id, discount_applied_at
      FROM table_sessions
      WHERE id = ${sessionId} AND merchant_id = ${merchantId}
      FOR UPDATE
    `;
    const session = rows[0];
    if (!session) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }
    return session;
  }

  private async requireOwnedSessionRef(
    client: DbClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const session = await client.tableSession.findFirst({
      where: { id: sessionId, merchantId },
      select: {
        id: true,
        tableId: true,
      },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }
    return session;
  }

  private async findOpenSessionId(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    // The dining-table row lock serializes competing creates for the same
    // table. Keep this first lookup non-locking so missing unique keys for two
    // different tables do not acquire overlapping InnoDB gap locks and
    // deadlock when both sessions are inserted. If a stale RR snapshot misses
    // a concurrently committed session, the unique key catches it below and
    // the retry path uses a current locking read.
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM table_sessions
      WHERE open_table_id = ${tableId}
        AND merchant_id = ${merchantId}
        AND table_id = ${tableId}
        AND status = 'OPEN'
    `;
    return rows[0]?.id ?? null;
  }

  private async findOpenSessionIdForUpdate(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM table_sessions
      WHERE open_table_id = ${tableId}
        AND merchant_id = ${merchantId}
        AND table_id = ${tableId}
        AND status = 'OPEN'
      FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }

  private async confirmOpenSessionIdForUpdate(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
    sessionId: bigint,
  ) {
    // Lock by the known primary key so this is a current read without taking a
    // missing-key gap lock on open_table_id. This detects a session that was
    // closed while this transaction waited for the dining-table row.
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM table_sessions
      WHERE id = ${sessionId}
        AND open_table_id = ${tableId}
        AND merchant_id = ${merchantId}
        AND table_id = ${tableId}
        AND status = 'OPEN'
      FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }

  private async lockTableRow(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    // Closing paths use this ownership lock directly so an administratively
    // disabled table can still release its existing session.
    const rows = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
      SELECT id, status
      FROM dining_tables
      WHERE id = ${tableId} AND merchant_id = ${merchantId}
      FOR UPDATE
    `;
    const table = rows[0];
    if (!table) {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: '桌台不存在',
      });
    }
    return table;
  }

  private async lockActiveTableRow(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    const table = await this.lockTableRow(tx, merchantId, tableId);
    if (table.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'TABLE_NOT_AVAILABLE',
        message: '桌台当前不可用',
      });
    }
  }

  private generateSessionNo() {
    const timestamp = new Date()
      .toISOString()
      .replace(/\D/g, '')
      .slice(2, 14);
    return `TS${timestamp}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private isOpenSessionUniqueViolation(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code !== 'P2002') {
      return false;
    }

    const target = Array.isArray(error.meta?.target)
      ? error.meta?.target.map((item) => String(item))
      : typeof error.meta?.target === 'string'
        ? [String(error.meta.target)]
        : [];

    const hasIndexName = target.some((item) =>
      item.includes('table_sessions_open_table_id_key'),
    );
    const hasOpenTableId = target.some((item) => item.includes('open_table_id'));

    return hasIndexName || hasOpenTableId;
  }

  private summarizeOrders(
    orders: Array<{
      status: OrderStatus;
      createdAt: Date;
      totalAmountVnd: bigint;
      items: Array<{ quantity: number }>;
    }>,
  ) {
    const billableOrders = orders.filter((order) =>
      BILLABLE_ORDER_STATUSES.includes(order.status),
    );

    const latestOrderAt = orders.reduce<Date | null>(
      (latest, order) =>
        !latest || order.createdAt > latest ? order.createdAt : latest,
      null,
    );

    return {
      orderCount: billableOrders.length,
      itemCount: billableOrders.reduce(
        (sum, order) =>
          sum +
          order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
        0,
      ),
      totalAmountVnd: billableOrders.reduce(
        (sum, order) => sum + order.totalAmountVnd,
        0n,
      ),
      latestOrderAt,
      pendingOrderCount: orders.filter(
        (order) => order.status === 'PENDING_ACCEPTANCE',
      ).length,
      unfinishedOrderCount: orders.filter((order) =>
        UNFINISHED_ORDER_STATUSES.includes(order.status),
      ).length,
    };
  }

  private serializeSessionSummary(
    session: OpenSessionSummaryRow,
    table: { id: bigint; tableNo: string; tableName: string | null },
  ) {
    const summary = this.summarizeOrders(session.orders);
    const roundingApplied = session.roundingAppliedByStaffId !== null;
    const roundingAmountVnd = roundingApplied
      ? session.roundingAmountVnd
      : 0n;
    const discountPayableRateBps = session.discountPayableRateBps ?? null;
    const discountAmountVnd = discountPayableRateBps === null
      ? 0n
      : session.discountAmountVnd;
    return {
      id: session.id,
      sessionNo: session.sessionNo,
      merchantId: session.merchantId,
      tableId: session.tableId,
      tableNo: table.tableNo,
      tableName: table.tableName,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      discountPayableRateBps,
      discountAmountVnd,
      discountAppliedByStaffId: session.discountAppliedByStaffId ?? null,
      discountAppliedAt: session.discountAppliedAt ?? null,
      roundingApplied,
      roundingAmountVnd,
      payableAmountVnd:
        summary.totalAmountVnd - discountAmountVnd - roundingAmountVnd,
      originalAmountVnd: summary.totalAmountVnd,
      ...summary,
    };
  }

  private serializeSessionDetail(
    session: Awaited<ReturnType<typeof this.requireOwnedSession>>,
  ) {
    const summary = this.summarizeOrders(session.orders);
    const roundingApplied = session.roundingAppliedByStaffId !== null;
    const roundingAmountVnd = roundingApplied
      ? session.roundingAmountVnd
      : 0n;
    const discountPayableRateBps = session.discountPayableRateBps ?? null;
    const discountAmountVnd = discountPayableRateBps === null
      ? 0n
      : session.discountAmountVnd;
    return {
      id: session.id,
      sessionNo: session.sessionNo,
      merchantId: session.merchantId,
      tableId: session.tableId,
      tableNo: session.table.tableNo,
      tableName: session.table.tableName,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      discountPayableRateBps,
      discountAmountVnd,
      discountAppliedByStaffId: session.discountAppliedByStaffId ?? null,
      discountAppliedAt: session.discountAppliedAt ?? null,
      roundingApplied,
      roundingAmountVnd,
      payableAmountVnd:
        summary.totalAmountVnd - discountAmountVnd - roundingAmountVnd,
      originalAmountVnd: summary.totalAmountVnd,
      ...summary,
      orders: session.orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        createdByStaffId: order.createdByStaffId,
        status: order.status,
        createdAt: order.createdAt,
        itemAmountVnd: order.itemAmountVnd,
        deliveryFeeVnd: order.deliveryFeeVnd,
        totalAmountVnd: order.totalAmountVnd,
        tableNoSnapshot: order.tableNoSnapshot,
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productNameZhSnapshot: item.productNameZhSnapshot,
          productNameZh: item.product?.nameZh ?? null,
          productNameVi: item.product?.nameVi ?? null,
          productNameEn: item.product?.nameEn ?? null,
          remark: item.remark,
          quantity: item.quantity,
          unitPriceVnd: item.unitPriceVnd,
          subtotalVnd: item.subtotalVnd,
        })),
      })),
    };
  }

  private readonly sessionOrdersInclude = {
    table: {
      select: {
        id: true,
        tableNo: true,
        tableName: true,
      },
    },
    orders: {
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            productNameZhSnapshot: true,
            remark: true,
            product: {
              select: { nameZh: true, nameVi: true, nameEn: true },
            },
            quantity: true,
            unitPriceVnd: true,
            subtotalVnd: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    },
  };

  // Keep checkout snapshots compatible with the merchant order detail contract
  // without injecting MerchantOrdersService back into TableSessionsModule.
  private readonly checkoutOrderInclude = {
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
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' as const },
      take: 10,
    },
  };

  private serializeLocalizedOrderItems<
    T extends { product?: { nameZh: string; nameVi: string | null } | null },
  >(items: readonly T[]) {
    return items.map((item) => {
      if (!Object.prototype.hasOwnProperty.call(item, 'product')) return item;
      const { product, ...snapshot } = item;
      return {
        ...snapshot,
        productNameZh: product?.nameZh ?? null,
        productNameVi: product?.nameVi ?? null,
      };
    });
  }
}
