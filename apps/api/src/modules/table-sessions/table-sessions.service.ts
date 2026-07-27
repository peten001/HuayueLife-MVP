import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { toMerchantVisibleOrderStatusLog } from '../orders/order-status-log-visibility';
import { PrintJobsService } from '../printing/services/print-jobs.service';
import { calculateTableSessionRoundingAmount } from './table-session.constants';

type DbClient = PrismaService | Prisma.TransactionClient;

type CheckoutOrderRow = {
  id: bigint;
  status: OrderStatus;
  order_type: OrderType;
  total_amount_vnd: bigint;
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
      include: this.sessionOrdersInclude,
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
        statusLogs: order.statusLogs.map(toMerchantVisibleOrderStatusLog),
      })),
    };
  }

  async checkoutSession(
    merchantId: bigint,
    staffId: bigint,
    sessionId: bigint,
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

      // The dining-table lock serializes checkout against new orders. Locking
      // every bound order then makes completion, status logs, and session close
      // one atomic state change for retries and concurrent checkout requests.
      const sessionOrders = await tx.$queryRaw<CheckoutOrderRow[]>`
        SELECT id, status, order_type, total_amount_vnd
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

      const originalAmountVnd = sessionOrders
        .filter((order) => BILLABLE_ORDER_STATUSES.includes(order.status))
        .reduce((sum, order) => sum + order.total_amount_vnd, 0n);
      const roundingApplied = session.rounding_applied_by_staff_id !== null;
      // setRounding persists the exact amount applied by the cashier. Keep
      // that historical value for checkout/print/order association so all
      // consumers agree even after a refresh.
      const roundingAmountVnd = roundingApplied
        ? session.rounding_amount_vnd
        : 0n;
      const payableAmountVnd = originalAmountVnd - roundingAmountVnd;
      const completedAt = new Date();
      const printTriggerIds: bigint[] = [];
      for (const order of sessionOrders) {
        if (!['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) continue;

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
              originalAmountVnd: originalAmountVnd.toString(),
              roundingAmountVnd: roundingAmountVnd.toString(),
              payableAmountVnd: payableAmountVnd.toString(),
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

      const closed = await tx.tableSession.updateMany({
        where: { id: sessionId, merchantId, status: 'OPEN' },
        data: {
          openTableId: null,
          status: 'CLOSED',
          closedAt: completedAt,
          roundingAmountVnd,
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException({
          code: 'TABLE_SESSION_STATUS_CHANGED',
          message: '桌账状态已变化，请刷新后重试。',
        });
      }

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
      const total = orders
        .filter((order) => BILLABLE_ORDER_STATUSES.includes(order.status))
        .reduce((sum, order) => sum + order.total_amount_vnd, 0n);
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          roundingAmountVnd: enabled
            ? calculateTableSessionRoundingAmount(total)
            : 0n,
          roundingAppliedByStaffId: enabled ? staffId : null,
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
    }>>`
      SELECT id, merchant_id, table_id, status, open_table_id, closed_at,
             rounding_amount_vnd, rounding_applied_by_staff_id
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
    session: Awaited<ReturnType<typeof this.requireOwnedSession>>,
    table: { id: bigint; tableNo: string; tableName: string | null },
  ) {
    const summary = this.summarizeOrders(session.orders);
    const roundingApplied = session.roundingAppliedByStaffId !== null;
    const roundingAmountVnd = roundingApplied
      ? session.roundingAmountVnd
      : 0n;
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
      roundingApplied,
      roundingAmountVnd,
      payableAmountVnd: summary.totalAmountVnd - roundingAmountVnd,
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
      roundingApplied,
      roundingAmountVnd,
      payableAmountVnd: summary.totalAmountVnd - roundingAmountVnd,
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
          productNameZhSnapshot: item.productNameZhSnapshot,
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
            productNameZhSnapshot: true,
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
}
