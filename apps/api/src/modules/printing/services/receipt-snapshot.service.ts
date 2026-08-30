import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import {
  assertReceiptDocument,
  immutableJsonSnapshot,
  ReceiptDocument,
  receiptTemplateDisplayFromDefinition,
} from '../types/receipt-document';
import { footerFromTemplateDefinition } from '../types/bilingual-receipt';
import { withOrderSettlementFields } from '../../orders/order-settlement-fields';
import {
  assertPrintDocumentV3,
  assertPrintDocumentV2,
  isPrintDocument,
  isPrintDocumentV2,
  isPrintDocumentV3,
  PrintDocument,
  PrintDocumentV2,
  PrintDocumentV3,
} from '../types/print-document';

export type PrintingSnapshot = ReceiptDocument | PrintDocument;

export class NoPrintableOrderDeltaError extends Error {
  constructor() {
    super('No printable items in this order event');
    this.name = 'NoPrintableOrderDeltaError';
  }
}

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

  async fromOrder(
    merchantId: bigint,
    orderId: bigint,
    categoryIds?: bigint[],
  ): Promise<ReceiptDocument> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, merchantId },
      include: {
        merchant: {
          select: {
            id: true,
            nameZh: true,
            nameVi: true,
            addressZh: true,
            addressDetail: true,
            contactPhone: true,
          },
        },
        table: { select: { tableNo: true, tableName: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { product: { select: { nameVi: true, categoryId: true } } },
        },
      },
    });
    if (!order) this.notFound('订单不存在');
    const settlement = withOrderSettlementFields(order);

    const categoryIdSet = categoryIds ? new Set(categoryIds) : null;
    const items = order.items.filter(
      (item) => !categoryIdSet || (item.product?.categoryId && categoryIdSet.has(item.product.categoryId)),
    );
    if (categoryIdSet && items.length === 0) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '厨房打印路由未匹配到可打印菜品',
      });
    }
    const itemAmountVnd = items.reduce((sum, item) => sum + item.subtotalVnd, 0n);
    const document: ReceiptDocument = {
      schemaVersion: 1,
      receiptType: 'ORDER_CUSTOMER',
      generatedAt: new Date().toISOString(),
      merchant: {
        id: order.merchant.id.toString(),
        name: order.merchant.nameZh,
        nameVi: order.merchant.nameVi ?? undefined,
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
      items: items.map((item) => ({
        name: item.productNameZhSnapshot,
        nameVi: item.product?.nameVi ?? undefined,
        quantity: item.quantity,
        unitPrice: safeVnd(item.unitPriceVnd),
        lineTotal: safeVnd(item.subtotalVnd),
        note: item.remark ?? undefined,
      })),
      totals: {
        subtotal: safeVnd(itemAmountVnd),
        ...(!categoryIdSet && settlement.discountAmountVnd > 0n
          ? { commercialDiscountAmount: safeVnd(settlement.discountAmountVnd) }
          : {}),
        ...(!categoryIdSet && settlement.roundingAmountVnd > 0n
          ? { discount: safeVnd(settlement.roundingAmountVnd) }
          : {}),
        originalAmount: safeVnd(categoryIdSet ? itemAmountVnd : settlement.originalAmountVnd),
        roundingAmount: safeVnd(categoryIdSet ? 0n : settlement.roundingAmountVnd),
        receivedAmount: safeVnd(categoryIdSet ? itemAmountVnd : settlement.payableAmountVnd),
        total: safeVnd(categoryIdSet ? itemAmountVnd : settlement.payableAmountVnd),
        currency: 'VND',
      },
      note: order.customerRemark ?? undefined,
      verificationCode: `YQ:ORDER:${order.id}:${order.orderNo}`,
    };
    return this.validateAndFreeze(document);
  }

  /**
   * Build an automatic receipt from the immutable positive delta captured by
   * the order-status event. Reusing one logical DINE_IN order must never make a
   * later add print the dishes that were already printed by earlier events.
   */
  async fromOrderAddition(
    merchantId: bigint,
    orderId: bigint,
    orderStatusLogId: bigint,
    categoryIds?: bigint[],
  ): Promise<ReceiptDocument> {
    const [base, statusLog] = await Promise.all([
      this.fromOrder(merchantId, orderId),
      this.prisma.orderStatusLog.findFirst({
        where: {
          id: orderStatusLogId,
          orderId,
          order: { merchantId },
        },
        select: { action: true, metadata: true },
      }),
    ]);
    if (!statusLog) this.notFound('订单打印事件不存在');
    const rawItems = printDeltaItems(statusLog.metadata);
    // Backward compatibility for already-committed outbox rows created before
    // event deltas existed. New append events are required to carry a delta.
    if (!rawItems) return categoryIds
      ? this.fromOrder(merchantId, orderId, categoryIds)
      : base;
    if (rawItems.length === 0) {
      throw new NoPrintableOrderDeltaError();
    }

    const productIds = [...new Set(rawItems.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { merchantId, id: { in: productIds } },
      select: { id: true, nameVi: true, categoryId: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const categoryIdSet = categoryIds ? new Set(categoryIds) : null;
    const routed = rawItems.filter((item) => {
      if (!categoryIdSet) return true;
      const categoryId = productById.get(item.productId)?.categoryId;
      return categoryId !== undefined && categoryIdSet.has(categoryId);
    });
    if (categoryIdSet && routed.length === 0) {
      throw new NoPrintableOrderDeltaError();
    }
    const items = aggregateReceiptItems(routed.map((item) => {
      const unitPrice = safeVnd(item.unitPriceVnd);
      const lineTotal = safeVnd(item.unitPriceVnd * BigInt(item.quantity));
      return {
        name: item.productNameSnapshot,
        nameVi: productById.get(item.productId)?.nameVi ?? undefined,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        note: item.remark ?? undefined,
      };
    }));
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    return this.validateAndFreeze({
      ...base,
      generatedAt: new Date().toISOString(),
      items,
      totals: {
        subtotal,
        originalAmount: subtotal,
        roundingAmount: 0,
        receivedAmount: subtotal,
        total: subtotal,
        currency: 'VND',
      },
      verificationCode: `YQ:ORDER_DELTA:${orderId}:${orderStatusLogId}`,
    });
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
            nameVi: true,
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
    // TableSession is the canonical settlement owner for DINE_IN. Snapshot
    // creation reads the persisted adjustment values exactly once; manual
    // reprints clone this immutable snapshot and never revisit child logs or
    // current menu prices.
    const commercialDiscountAmount = session.discountAmountVnd ?? 0n;
    const roundingAmount = session.roundingAmountVnd ?? 0n;
    if (
      commercialDiscountAmount < 0n ||
      roundingAmount < 0n ||
      commercialDiscountAmount + roundingAmount > total
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '桌台结算金额无效，无法生成打印快照',
      });
    }
    const finalReceivable = total - commercialDiscountAmount - roundingAmount;
    const tableItems = aggregateReceiptItems(
      session.orders.flatMap((order) =>
        order.items.map((item) => ({
          name: item.productNameZhSnapshot,
          nameVi: item.product?.nameVi ?? undefined,
          quantity: item.quantity,
          unitPrice: safeVnd(item.unitPriceVnd),
          lineTotal: safeVnd(item.subtotalVnd),
          note: item.remark ?? undefined,
        })),
      ),
    );
    const document: ReceiptDocument = {
      schemaVersion: 1,
      receiptType: 'TABLE_BILL',
      generatedAt: new Date().toISOString(),
      merchant: {
        id: session.merchant.id.toString(),
        name: session.merchant.nameZh,
        nameVi: session.merchant.nameVi ?? undefined,
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
      items: tableItems,
      totals: {
        subtotal: safeVnd(subtotal),
        ...(commercialDiscountAmount > 0n
          ? { commercialDiscountAmount: safeVnd(commercialDiscountAmount) }
          : {}),
        ...(roundingAmount > 0n
          ? { discount: safeVnd(roundingAmount) }
          : {}),
        originalAmount: safeVnd(total),
        roundingAmount: safeVnd(roundingAmount),
        receivedAmount: safeVnd(finalReceivable),
        total: safeVnd(finalReceivable),
        currency: 'VND',
      },
      paymentMethod: session.paymentMethod ?? undefined,
      verificationCode: `YQ:TABLE:${session.id}:${session.sessionNo}`,
    };
    return this.validateAndFreeze(document);
  }

  cloneAndValidate(document: ReceiptDocument): ReceiptDocument;
  cloneAndValidate(document: PrintDocumentV2): PrintDocumentV2;
  cloneAndValidate(document: PrintDocumentV3): PrintDocumentV3;
  cloneAndValidate(document: PrintingSnapshot): PrintingSnapshot;
  cloneAndValidate(document: PrintingSnapshot): PrintingSnapshot {
    if (isPrintDocument(document)) return this.validatePrintDocumentAndFreeze(document);
    return this.validateAndFreeze(document);
  }

  withTemplate(document: ReceiptDocument, definition?: unknown) {
    return this.validateAndFreeze({
      ...document,
      footer: footerFromTemplateDefinition(definition),
    });
  }

  displaySettingsFromTemplate(definition?: unknown) {
    return receiptTemplateDisplayFromDefinition(definition);
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

  private validatePrintDocumentAndFreeze(document: PrintDocument) {
    try {
      const snapshot = immutableJsonSnapshot(document);
      if (isPrintDocumentV2(snapshot)) assertPrintDocumentV2(snapshot);
      else if (isPrintDocumentV3(snapshot)) assertPrintDocumentV3(snapshot);
      else throw new Error('Unsupported print document schema');
      return deepFreeze(snapshot);
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.TEMPLATE_INVALID,
        message: error instanceof Error ? error.message : '打印文档快照无效',
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

interface PrintDeltaItem {
  productId: bigint;
  productNameSnapshot: string;
  quantity: number;
  remark: string | null;
  unitPriceVnd: bigint;
}

function printDeltaItems(metadata: Prisma.JsonValue | null): PrintDeltaItem[] | null {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  const value = (metadata as Prisma.JsonObject).printDeltaItems;
  if (value === undefined) return null;
  if (!Array.isArray(value)) invalidPrintDelta();
  return value.map((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') invalidPrintDelta();
    const item = entry as Prisma.JsonObject;
    if (
      typeof item.productId !== 'string'
      || !/^\d+$/.test(item.productId)
      || typeof item.productNameSnapshot !== 'string'
      || !item.productNameSnapshot.trim()
      || typeof item.quantity !== 'number'
      || !Number.isSafeInteger(item.quantity)
      || item.quantity <= 0
      || typeof item.unitPriceVnd !== 'string'
      || !/^\d+$/.test(item.unitPriceVnd)
      || (item.remark !== null && item.remark !== undefined && typeof item.remark !== 'string')
    ) {
      invalidPrintDelta();
    }
    return {
      productId: BigInt(item.productId),
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      remark: typeof item.remark === 'string' ? item.remark : null,
      unitPriceVnd: BigInt(item.unitPriceVnd),
    };
  });
}

function invalidPrintDelta(): never {
  throw new BadRequestException({
    code: PRINTING_ERROR_CODES.CONFIG_INVALID,
    message: '订单新增菜品打印快照无效',
  });
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

function aggregateReceiptItems(items: ReceiptDocument['items']) {
  const grouped = new Map<string, ReceiptDocument['items'][number]>();
  for (const item of items) {
    const key = JSON.stringify([
      item.name,
      item.nameVi ?? '',
      item.nameEn ?? '',
      item.specification ?? '',
      item.note ?? '',
      item.unitPrice,
    ]);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.lineTotal += item.lineTotal;
    } else {
      grouped.set(key, { ...item });
    }
  }
  return [...grouped.values()];
}
