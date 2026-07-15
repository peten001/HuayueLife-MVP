import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import {
  assertReceiptDocument,
  immutableJsonSnapshot,
  ReceiptDocument,
} from '../types/receipt-document';

const BILLABLE_ORDER_STATUSES: OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
];

@Injectable()
export class ReceiptSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async fromOrder(merchantId: bigint, orderId: bigint): Promise<ReceiptDocument> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, merchantId },
      include: {
        merchant: {
          select: {
            id: true,
            nameZh: true,
            addressZh: true,
            addressDetail: true,
            contactPhone: true,
          },
        },
        table: { select: { tableNo: true, tableName: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { product: { select: { nameVi: true } } },
        },
      },
    });
    if (!order) this.notFound('订单不存在');

    const document: ReceiptDocument = {
      schemaVersion: 1,
      receiptType: 'ORDER_CUSTOMER',
      generatedAt: new Date().toISOString(),
      merchant: {
        id: order.merchant.id.toString(),
        name: order.merchant.nameZh,
        address:
          order.merchant.addressZh ?? order.merchant.addressDetail ?? undefined,
        phone: order.merchant.contactPhone ?? undefined,
      },
      order: {
        id: order.id.toString(),
        orderNo: order.orderNo,
        orderType: order.orderType,
        tableName:
          order.table?.tableName ?? order.table?.tableNo ?? order.tableNoSnapshot ?? undefined,
        createdAt: order.createdAt.toISOString(),
        completedAt: order.completedAt?.toISOString(),
      },
      items: order.items.map((item) => ({
        name: item.productNameZhSnapshot,
        nameVi: item.product?.nameVi ?? undefined,
        quantity: item.quantity,
        unitPrice: safeVnd(item.unitPriceVnd),
        lineTotal: safeVnd(item.subtotalVnd),
        note: item.remark ?? undefined,
      })),
      totals: {
        subtotal: safeVnd(order.itemAmountVnd),
        total: safeVnd(order.totalAmountVnd),
        currency: 'VND',
      },
      note: order.customerRemark ?? undefined,
    };
    return this.validateAndFreeze(document);
  }

  async fromTableSession(
    merchantId: bigint,
    tableSessionId: bigint,
  ): Promise<ReceiptDocument> {
    const session = await this.prisma.tableSession.findFirst({
      where: { id: tableSessionId, merchantId },
      include: {
        merchant: {
          select: {
            id: true,
            nameZh: true,
            addressZh: true,
            addressDetail: true,
            contactPhone: true,
          },
        },
        table: { select: { tableNo: true, tableName: true } },
        orders: {
          where: { status: { in: BILLABLE_ORDER_STATUSES } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            items: {
              orderBy: { id: 'asc' },
              include: { product: { select: { nameVi: true } } },
            },
          },
        },
      },
    });
    if (!session) this.notFound('桌台账单不存在');

    const subtotal = session.orders.reduce(
      (sum, order) => sum + order.itemAmountVnd,
      0n,
    );
    const total = session.orders.reduce(
      (sum, order) => sum + order.totalAmountVnd,
      0n,
    );
    const document: ReceiptDocument = {
      schemaVersion: 1,
      receiptType: 'TABLE_BILL',
      generatedAt: new Date().toISOString(),
      merchant: {
        id: session.merchant.id.toString(),
        name: session.merchant.nameZh,
        address:
          session.merchant.addressZh ?? session.merchant.addressDetail ?? undefined,
        phone: session.merchant.contactPhone ?? undefined,
      },
      tableSession: {
        id: session.id.toString(),
        sessionNo: session.sessionNo,
        tableName: session.table.tableName ?? session.table.tableNo,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString(),
        orderNos: session.orders.map((order) => order.orderNo),
      },
      items: session.orders.flatMap((order) =>
        order.items.map((item) => ({
          name: item.productNameZhSnapshot,
          nameVi: item.product?.nameVi ?? undefined,
          quantity: item.quantity,
          unitPrice: safeVnd(item.unitPriceVnd),
          lineTotal: safeVnd(item.subtotalVnd),
          note: item.remark ?? undefined,
        })),
      ),
      totals: {
        subtotal: safeVnd(subtotal),
        total: safeVnd(total),
        currency: 'VND',
      },
    };
    return this.validateAndFreeze(document);
  }

  cloneAndValidate(document: ReceiptDocument) {
    return this.validateAndFreeze(document);
  }

  private validateAndFreeze(document: ReceiptDocument) {
    try {
      const snapshot = immutableJsonSnapshot(document);
      assertReceiptDocument(snapshot);
      return deepFreeze(snapshot);
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.TEMPLATE_INVALID,
        message: error instanceof Error ? error.message : '小票快照无效',
      });
    }
  }

  private notFound(message: string): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message,
    });
  }
}

function safeVnd(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.TEMPLATE_INVALID,
      message: '金额超出小票 V1 可表示范围',
    });
  }
  return number;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
