import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

type DbClient = PrismaService | Prisma.TransactionClient;

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
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateOpenSession(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ): Promise<{ id: bigint }> {
    await this.lockTableRow(tx, merchantId, tableId);

    const existingId = await this.findOpenSessionIdForUpdate(tx, merchantId, tableId);
    if (existingId) {
      return { id: existingId };
    }

    try {
      return await tx.tableSession.create({
        data: {
          merchantId,
          tableId,
          openTableId: tableId,
          sessionNo: this.generateSessionNo(),
        },
      });
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
        return { id: sessionId };
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
    const session = await this.requireOwnedSession(this.prisma, merchantId, sessionId);
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

      const unfinishedCount = await tx.order.count({
        where: {
          tableSessionId: sessionId,
          status: { in: UNFINISHED_ORDER_STATUSES },
        },
      });
      if (unfinishedCount > 0) {
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
    }>>`
      SELECT id, merchant_id, table_id, status, open_table_id, closed_at
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

  private async findOpenSessionIdForUpdate(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM table_sessions
      WHERE merchant_id = ${merchantId}
        AND table_id = ${tableId}
        AND open_table_id IS NOT NULL
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }

  private async lockTableRow(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    tableId: bigint,
  ) {
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
      ...summary,
    };
  }

  private serializeSessionDetail(
    session: Awaited<ReturnType<typeof this.requireOwnedSession>>,
  ) {
    const summary = this.summarizeOrders(session.orders);
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
      ...summary,
      orders: session.orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
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
}
