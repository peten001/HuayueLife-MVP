import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { calculateSettlementAdjustment } from '../orders/settlement-adjustment';

export const DINE_IN_CANONICAL_BILLABLE_STATUSES = new Set<OrderStatus>([
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
]);

export type DineInCanonicalAdjustability = 'DECREASE' | 'RETURN' | 'LOCKED';

export type DineInCanonicalSessionRow = {
  id: bigint;
  merchantId: bigint;
  tableId: bigint;
  status: string;
  openTableId: bigint | null;
  tableNo: string;
  tableName: string | null;
  discountPayableRateBps: number | null;
  discountAmountVnd: bigint;
  discountAppliedByStaffId: bigint | null;
  roundingAmountVnd: bigint;
  roundingAppliedByStaffId: bigint | null;
};

export type DineInCanonicalOrderRow = {
  id: bigint;
  status: OrderStatus;
  orderType: OrderType;
  userId: bigint | null;
  createdByStaffId: bigint | null;
  itemAmountVnd: bigint;
  deliveryFeeVnd: bigint;
  totalAmountVnd: bigint;
};

export type DineInCanonicalItemRow = {
  id: bigint;
  orderId: bigint;
  productId: bigint | null;
  productNameZhSnapshot: string;
  productNameZh: string | null;
  productNameVi: string | null;
  productNameEn: string | null;
  remark: string | null;
  unitPriceVnd: bigint;
  quantity: number;
  subtotalVnd: bigint;
};

export type DineInCanonicalSource = {
  session: DineInCanonicalSessionRow;
  orders: DineInCanonicalOrderRow[];
  items: DineInCanonicalItemRow[];
};

export type DineInCanonicalLineInternal = {
  lineKey: string;
  productId: string | null;
  productNameZh: string;
  productNameVi: string | null;
  productNameEn: string | null;
  remark: string;
  optionSignature: string;
  unitPriceVnd: string;
  quantity: number;
  lockedQuantity: number;
  adjustableQuantity: number;
  subtotalVnd: string;
  adjustability: DineInCanonicalAdjustability;
  sourceSummary: {
    staffQuantity: number;
    qrQuantity: number;
  };
  rawItems: Array<{
    itemId: bigint;
    orderId: bigint;
    orderStatus: OrderStatus;
    quantity: number;
    unitPriceVnd: bigint;
  }>;
};

export type DineInCanonicalStateInternal = {
  sessionId: string;
  tableId: string;
  tableNo: string;
  tableName: string | null;
  sessionStatus: string;
  revision: string;
  items: DineInCanonicalLineInternal[];
  totals: {
    originalAmountVnd: string;
    discountPayableRateBps: number | null;
    discountAmountVnd: string;
    roundingAmountVnd: string;
    payableAmountVnd: string;
  };
  blockers: string[];
  generatedAt: string;
};

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class DineInCanonicalStateService {
  constructor(private readonly prisma: PrismaService) {}

  getState(merchantId: bigint, sessionId: bigint) {
    return this.prisma.$transaction(
      async (tx) => this.buildWithClient(tx, merchantId, sessionId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async buildWithClient(
    client: DbClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const session = await client.tableSession.findFirst({
      where: { id: sessionId, merchantId },
      select: {
        id: true,
        merchantId: true,
        tableId: true,
        status: true,
        openTableId: true,
        discountPayableRateBps: true,
        discountAmountVnd: true,
        discountAppliedByStaffId: true,
        roundingAmountVnd: true,
        roundingAppliedByStaffId: true,
        table: { select: { tableNo: true, tableName: true } },
        orders: {
          select: {
            id: true,
            status: true,
            orderType: true,
            userId: true,
            createdByStaffId: true,
            itemAmountVnd: true,
            deliveryFeeVnd: true,
            totalAmountVnd: true,
            items: {
              select: {
                id: true,
                orderId: true,
                productId: true,
                productNameZhSnapshot: true,
                product: {
                  select: { nameZh: true, nameVi: true, nameEn: true },
                },
                remark: true,
                unitPriceVnd: true,
                quantity: true,
                subtotalVnd: true,
              },
              orderBy: { id: 'asc' },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }
    const source: DineInCanonicalSource = {
      session: {
        id: session.id,
        merchantId: session.merchantId,
        tableId: session.tableId,
        status: session.status,
        openTableId: session.openTableId,
        tableNo: session.table.tableNo,
        tableName: session.table.tableName,
        discountPayableRateBps: session.discountPayableRateBps,
        discountAmountVnd: session.discountAmountVnd,
        discountAppliedByStaffId: session.discountAppliedByStaffId,
        roundingAmountVnd: session.roundingAmountVnd,
        roundingAppliedByStaffId: session.roundingAppliedByStaffId,
      },
      orders: session.orders.map(({ items: _items, ...order }) => order),
      items: session.orders.flatMap((order) => order.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        productNameZhSnapshot: item.productNameZhSnapshot,
        productNameZh: item.product?.nameZh ?? null,
        productNameVi: item.product?.nameVi ?? null,
        productNameEn: item.product?.nameEn ?? null,
        remark: item.remark,
        unitPriceVnd: item.unitPriceVnd,
        quantity: item.quantity,
        subtotalVnd: item.subtotalVnd,
      }))),
    };
    return this.toPublicState(this.build(source));
  }

  /**
   * Builds from current locking reads. Callers must lock the dining-table row
   * first so every DINE_IN writer follows table -> session -> orders -> items.
   */
  async buildLockedWithClient(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    sessionId: bigint,
  ) {
    const sessionRows = await tx.$queryRaw<Array<{
      id: bigint;
      merchant_id: bigint;
      table_id: bigint;
      status: string;
      open_table_id: bigint | null;
      table_no: string;
      table_name: string | null;
      discount_payable_rate_bps: number | null;
      discount_amount_vnd: bigint;
      discount_applied_by_staff_id: bigint | null;
      rounding_amount_vnd: bigint;
      rounding_applied_by_staff_id: bigint | null;
    }>>`
      SELECT ts.id, ts.merchant_id, ts.table_id, ts.status, ts.open_table_id,
             dt.table_no, dt.table_name,
             ts.discount_payable_rate_bps, ts.discount_amount_vnd,
             ts.discount_applied_by_staff_id, ts.rounding_amount_vnd,
             ts.rounding_applied_by_staff_id
      FROM table_sessions ts
      INNER JOIN dining_tables dt ON dt.id = ts.table_id
      WHERE ts.id = ${sessionId} AND ts.merchant_id = ${merchantId}
      FOR UPDATE
    `;
    const lockedSession = sessionRows[0];
    if (!lockedSession) {
      throw new NotFoundException({
        code: 'TABLE_SESSION_NOT_FOUND',
        message: '桌台会话不存在',
      });
    }
    const orderRows = await tx.$queryRaw<Array<{
      id: bigint;
      status: OrderStatus;
      order_type: OrderType;
      user_id: bigint | null;
      created_by_staff_id: bigint | null;
      item_amount_vnd: bigint;
      delivery_fee_vnd: bigint;
      total_amount_vnd: bigint;
    }>>`
      SELECT id, status, order_type, user_id, created_by_staff_id,
             item_amount_vnd, delivery_fee_vnd, total_amount_vnd
      FROM orders
      WHERE table_session_id = ${sessionId} AND merchant_id = ${merchantId}
      ORDER BY id
      FOR UPDATE
    `;
    const itemRows = await tx.$queryRaw<Array<{
      id: bigint;
      order_id: bigint;
      product_id: bigint | null;
      product_name_zh_snapshot: string;
      remark: string | null;
      unit_price_vnd: bigint;
      quantity: number;
      subtotal_vnd: bigint;
    }>>`
      SELECT oi.id, oi.order_id, oi.product_id,
             oi.product_name_zh_snapshot,
             oi.remark, oi.unit_price_vnd, oi.quantity, oi.subtotal_vnd
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.table_session_id = ${sessionId} AND o.merchant_id = ${merchantId}
      ORDER BY oi.order_id, oi.id
      FOR UPDATE
    `;
    // Product names are cosmetic. Read them only after the canonical write-lock
    // chain is complete so product maintenance can never invert the required
    // table -> session -> orders -> items lock order.
    const productIds = [...new Set(itemRows
      .map((item) => item.product_id)
      .filter((productId): productId is bigint => productId !== null))];
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nameZh: true, nameVi: true, nameEn: true },
        })
      : [];
    const productsById = new Map(
      products.map((product) => [product.id.toString(), product]),
    );
    return this.build({
      session: {
        id: lockedSession.id,
        merchantId: lockedSession.merchant_id,
        tableId: lockedSession.table_id,
        status: lockedSession.status,
        openTableId: lockedSession.open_table_id,
        tableNo: lockedSession.table_no,
        tableName: lockedSession.table_name,
        discountPayableRateBps: lockedSession.discount_payable_rate_bps,
        discountAmountVnd: lockedSession.discount_amount_vnd,
        discountAppliedByStaffId: lockedSession.discount_applied_by_staff_id,
        roundingAmountVnd: lockedSession.rounding_amount_vnd,
        roundingAppliedByStaffId: lockedSession.rounding_applied_by_staff_id,
      },
      orders: orderRows.map((order) => ({
        id: order.id,
        status: order.status,
        orderType: order.order_type,
        userId: order.user_id,
        createdByStaffId: order.created_by_staff_id,
        itemAmountVnd: order.item_amount_vnd,
        deliveryFeeVnd: order.delivery_fee_vnd,
        totalAmountVnd: order.total_amount_vnd,
      })),
      items: itemRows.map((item) => {
        const product = item.product_id
          ? productsById.get(item.product_id.toString())
          : undefined;
        return {
          id: item.id,
          orderId: item.order_id,
          productId: item.product_id,
          productNameZhSnapshot: item.product_name_zh_snapshot,
          productNameZh: product?.nameZh ?? null,
          productNameVi: product?.nameVi ?? null,
          productNameEn: product?.nameEn ?? null,
          remark: item.remark,
          unitPriceVnd: item.unit_price_vnd,
          quantity: item.quantity,
          subtotalVnd: item.subtotal_vnd,
        };
      }),
    });
  }

  build(source: DineInCanonicalSource): DineInCanonicalStateInternal {
    const ordersById = new Map(source.orders.map((order) => [order.id, order]));
    const grouped = new Map<string, DineInCanonicalLineInternal>();
    const blockers = new Set<string>();

    for (const order of source.orders) {
      if (order.orderType !== 'DINE_IN') blockers.add('NON_DINE_IN_ORDER');
      if (order.status === 'PENDING_ACCEPTANCE') blockers.add('UNACCEPTED_ORDER');
      if (!DINE_IN_CANONICAL_BILLABLE_STATUSES.has(order.status) && order.status !== 'CANCELLED') {
        blockers.add('UNSUPPORTED_ORDER_STATUS');
      }
    }

    for (const item of source.items) {
      const order = ordersById.get(item.orderId);
      if (!order || order.orderType !== 'DINE_IN' || !DINE_IN_CANONICAL_BILLABLE_STATUSES.has(order.status)) continue;
      const remark = normalizeCanonicalText(item.remark);
      const optionSignature = '';
      const identity = item.productId
        ? `product:${item.productId.toString()}`
        : `historical:${normalizeCanonicalText(item.productNameZhSnapshot).toLocaleLowerCase('zh-Hans-CN')}`;
      const lineKey = canonicalLineKey({
        sessionId: source.session.id,
        identity,
        remark,
        unitPriceVnd: item.unitPriceVnd,
        optionSignature,
      });
      const locked = order.status === 'COMPLETED' || order.status === 'DELIVERING';
      const current = grouped.get(lineKey) ?? {
        lineKey,
        productId: item.productId?.toString() ?? null,
        productNameZh: item.productNameZh ?? item.productNameZhSnapshot,
        productNameVi: item.productNameVi,
        productNameEn: item.productNameEn,
        remark,
        optionSignature,
        unitPriceVnd: item.unitPriceVnd.toString(),
        quantity: 0,
        lockedQuantity: 0,
        adjustableQuantity: 0,
        subtotalVnd: '0',
        adjustability: 'LOCKED' as const,
        sourceSummary: { staffQuantity: 0, qrQuantity: 0 },
        rawItems: [],
      };
      current.quantity += item.quantity;
      current.subtotalVnd = (BigInt(current.subtotalVnd) + item.subtotalVnd).toString();
      if (locked) current.lockedQuantity += item.quantity;
      else current.adjustableQuantity += item.quantity;
      if (order.createdByStaffId) current.sourceSummary.staffQuantity += item.quantity;
      else current.sourceSummary.qrQuantity += item.quantity;
      current.rawItems.push({
        itemId: item.id,
        orderId: item.orderId,
        orderStatus: order.status,
        quantity: item.quantity,
        unitPriceVnd: item.unitPriceVnd,
      });
      grouped.set(lineKey, current);
    }

    const items = [...grouped.values()]
      .map((line) => ({
        ...line,
        adjustability: resolveAdjustability(line.rawItems),
        rawItems: [...line.rawItems].sort(compareRawItems),
      }))
      .sort((left, right) => left.lineKey.localeCompare(right.lineKey));
    const originalAmountVnd = items.reduce(
      (sum, item) => sum + BigInt(item.subtotalVnd),
      0n,
    );
    const roundingEnabled = source.session.roundingAppliedByStaffId !== null;
    const settlement = calculateSettlementAdjustment({
      itemAmountVnd: originalAmountVnd,
      discountPayableRateBps: source.session.discountPayableRateBps,
      roundingEnabled,
    });
    const revisionPayload = {
      session: {
        id: source.session.id.toString(),
        merchantId: source.session.merchantId.toString(),
        tableId: source.session.tableId.toString(),
        status: source.session.status,
        openTableId: source.session.openTableId?.toString() ?? null,
        discountPayableRateBps: source.session.discountPayableRateBps,
        discountAmountVnd: source.session.discountAmountVnd.toString(),
        discountAppliedByStaffId: source.session.discountAppliedByStaffId?.toString() ?? null,
        roundingAmountVnd: source.session.roundingAmountVnd.toString(),
        roundingAppliedByStaffId: source.session.roundingAppliedByStaffId?.toString() ?? null,
      },
      orders: [...source.orders]
        .sort((left, right) => compareBigInt(left.id, right.id))
        .map((order) => ({
          id: order.id.toString(),
          status: order.status,
          orderType: order.orderType,
          userId: order.userId?.toString() ?? null,
          createdByStaffId: order.createdByStaffId?.toString() ?? null,
          itemAmountVnd: order.itemAmountVnd.toString(),
          deliveryFeeVnd: order.deliveryFeeVnd.toString(),
          totalAmountVnd: order.totalAmountVnd.toString(),
        })),
      items: [...source.items]
        .sort((left, right) => compareBigInt(left.id, right.id))
        .map((item) => ({
          id: item.id.toString(),
          orderId: item.orderId.toString(),
          productId: item.productId?.toString() ?? null,
          productNameZhSnapshot: item.productNameZhSnapshot,
          remark: normalizeCanonicalText(item.remark),
          unitPriceVnd: item.unitPriceVnd.toString(),
          quantity: item.quantity,
          subtotalVnd: item.subtotalVnd.toString(),
        })),
    };
    return {
      sessionId: source.session.id.toString(),
      tableId: source.session.tableId.toString(),
      tableNo: source.session.tableNo,
      tableName: source.session.tableName,
      sessionStatus: source.session.status,
      revision: `dcs2:sha256:${sha256(stableStringify(revisionPayload))}`,
      items,
      totals: {
        originalAmountVnd: originalAmountVnd.toString(),
        discountPayableRateBps: settlement.discountPayableRateBps,
        discountAmountVnd: settlement.discountAmountVnd.toString(),
        roundingAmountVnd: settlement.roundingAmountVnd.toString(),
        payableAmountVnd: settlement.payableAmountVnd.toString(),
      },
      blockers: [...blockers].sort(),
      generatedAt: new Date().toISOString(),
    };
  }

  toPublicState(state: DineInCanonicalStateInternal) {
    return {
      ...state,
      items: state.items.map(({ rawItems: _rawItems, ...item }) => item),
    };
  }

  assertOpenDineInState(state: DineInCanonicalStateInternal) {
    if (state.sessionStatus !== 'OPEN') {
      throw new ConflictException({
        code: 'TABLE_SESSION_EXTERNALLY_CLOSED',
        message: '桌账已关闭，请刷新桌台状态。',
        latestState: this.toPublicState(state),
      });
    }
    if (state.blockers.includes('NON_DINE_IN_ORDER')) {
      throw new ConflictException({
        code: 'TABLE_SESSION_HAS_NON_DINE_IN_ORDERS',
        message: '桌账包含非堂食订单，无法执行堂食对账。',
      });
    }
  }
}

export function normalizeCanonicalText(value: string | null | undefined) {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function canonicalLineKey(input: {
  sessionId: bigint;
  identity: string;
  remark: string;
  unitPriceVnd: bigint;
  optionSignature: string;
}) {
  return `dline:sha256:${sha256(stableStringify({
    sessionId: input.sessionId.toString(),
    identity: input.identity,
    remark: input.remark,
    unitPriceVnd: input.unitPriceVnd.toString(),
    optionSignature: input.optionSignature,
  }))}`;
}

export function canonicalPayloadHash(value: unknown) {
  return sha256(stableStringify(value));
}

function resolveAdjustability(
  rawItems: DineInCanonicalLineInternal['rawItems'],
): DineInCanonicalAdjustability {
  if (rawItems.some((item) => item.orderStatus === 'PENDING_ACCEPTANCE')) return 'DECREASE';
  if (rawItems.some((item) => ['ACCEPTED', 'PREPARING', 'READY'].includes(item.orderStatus))) return 'RETURN';
  return 'LOCKED';
}

function compareRawItems(
  left: DineInCanonicalLineInternal['rawItems'][number],
  right: DineInCanonicalLineInternal['rawItems'][number],
) {
  const rank = (status: OrderStatus) => status === 'PENDING_ACCEPTANCE' ? 0
    : status === 'ACCEPTED' ? 1
      : status === 'PREPARING' ? 2
        : status === 'READY' ? 3
          : 4;
  return rank(left.orderStatus) - rank(right.orderStatus)
    || compareBigInt(left.orderId, right.orderId)
    || compareBigInt(left.itemId, right.itemId);
}

function compareBigInt(left: bigint, right: bigint) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
