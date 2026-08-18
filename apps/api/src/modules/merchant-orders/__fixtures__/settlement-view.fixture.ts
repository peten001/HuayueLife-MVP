import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';
import type {
  SettlementItemRow,
  SettlementOrderRow,
  SettlementSessionRow,
} from '../merchant-settlements';

/**
 * Anonymous business-structure fixtures for the merchant Settlement View.
 *
 * The session shapes mirror the verified Merchant 11 / 2026-08-17 audit
 * (Session 415: 3 child orders, 309,000 original, 9,000 rounding, 300,000
 * final; Session 417: 5 child orders, 1,458,000 original, 8,000 rounding,
 * 1,450,000 final). All ids, order numbers and merchant references are
 * synthetic; no production privacy data is copied.
 */

export const SETTLEMENT_TEST_SCHEDULE = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((weekday) => [weekday, ['17:00-02:00']]),
) as Record<string, string[]>;

let itemSequence = 1n;

export function settlementFixtureOrder(
  input: {
    id: bigint;
    orderNo: string;
    status?: OrderStatus;
    orderType?: OrderType;
    createdAt: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
    businessDate?: string | null;
    totalAmountVnd: bigint;
    discountPayableRateBps?: number | null;
    discountAmountVnd?: bigint | null;
    roundingAmountVnd?: bigint | null;
    paymentMethod?: PaymentMethod | null;
    tableId?: bigint | null;
    tableSessionId?: bigint | null;
    tableNoSnapshot?: string | null;
    tableSession?: SettlementSessionRow | null;
    table?: SettlementOrderRow['table'];
    items?: SettlementOrderRow['items'];
    checkoutLogs?: SettlementOrderRow['checkoutLogs'];
  },
): SettlementOrderRow {
  const itemAmountVnd = input.items?.reduce(
    (sum, item) => sum + BigInt(item.subtotalVnd),
    0n,
  ) ?? input.totalAmountVnd;
  return {
    id: input.id,
    orderNo: input.orderNo,
    status: input.status ?? 'COMPLETED',
    orderType: input.orderType ?? 'DINE_IN',
    createdAt: new Date(input.createdAt),
    completedAt: input.completedAt == null ? null : new Date(input.completedAt),
    cancelledAt: input.cancelledAt == null ? null : new Date(input.cancelledAt),
    updatedAt: new Date(input.completedAt ?? input.cancelledAt ?? input.createdAt),
    businessDate: input.businessDate == null ? null : new Date(`${input.businessDate}T00:00:00.000Z`),
    totalAmountVnd: input.totalAmountVnd,
    itemAmountVnd,
    deliveryFeeVnd: 0n,
    discountPayableRateBps: input.discountPayableRateBps ?? null,
    discountAmountVnd: input.discountAmountVnd ?? 0n,
    roundingAmountVnd: input.roundingAmountVnd ?? 0n,
    paymentMethod: input.paymentMethod ?? null,
    tableId: input.tableId ?? null,
    tableSessionId: input.tableSessionId ?? null,
    tableNoSnapshot: input.tableNoSnapshot ?? null,
    tableSession: input.tableSession ?? null,
    table: input.table ?? null,
    items: input.items ?? [],
    checkoutLogs: input.checkoutLogs,
  };
}

export function settlementFixtureItem(
  input: {
    productId?: bigint;
    name?: string;
    unitPriceVnd: bigint;
    quantity: number;
    remark?: string | null;
    nameVi?: string | null;
  },
): SettlementItemRow {
  const id = itemSequence++;
  return {
    id,
    productId: input.productId ?? 1000n + id,
    productNameZhSnapshot: input.name ?? `测试菜品${id}`,
    imageUrlSnapshot: null,
    unitPriceVnd: input.unitPriceVnd,
    quantity: input.quantity,
    subtotalVnd: input.unitPriceVnd * BigInt(input.quantity),
    remark: input.remark ?? null,
    product: {
      nameZh: input.name ?? `测试菜品${id}`,
      nameVi: input.nameVi ?? null,
      nameEn: null,
    },
  };
}

export function closedSession(
  input: {
    id: bigint;
    closedAt: string;
    businessDate: string;
    paymentMethod?: PaymentMethod | null;
    discountAmountVnd?: bigint;
    roundingAmountVnd?: bigint;
  },
): SettlementSessionRow {
  return {
    id: input.id,
    status: 'CLOSED',
    closedAt: new Date(input.closedAt),
    businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
    paymentMethod: input.paymentMethod ?? 'CASH',
    discountAmountVnd: input.discountAmountVnd ?? 0n,
    roundingAmountVnd: input.roundingAmountVnd ?? 0n,
  };
}

export const TABLE_BAN9 = {
  id: 9001n,
  tableNo: '9',
  tableName: 'Bàn 9',
};

export const TABLE_02 = {
  id: 9002n,
  tableNo: '02',
  tableName: '02',
};

/** Session 415 / Bàn 9: 3 child orders, 309,000 - 9,000 = 300,000. */
export function session415Fixture(): SettlementOrderRow[] {
  const session = closedSession({
    id: 415n,
    closedAt: '2026-08-17T10:42:15.000Z',
    businessDate: '2026-08-17',
    paymentMethod: 'CASH',
    roundingAmountVnd: 9_000n,
  });
  const checkoutLog = {
    originalAmountVnd: '309000',
    discountAmountVnd: '0',
    roundingAmountVnd: '9000',
    finalPayableAmountVnd: '300000',
    payableAmountVnd: '300000',
    paymentMethod: 'CASH',
  };
  return [
    settlementFixtureOrder({
      id: 628n,
      orderNo: 'HY-TEST-628',
      createdAt: '2026-08-17T10:13:15.000Z',
      completedAt: '2026-08-17T10:42:15.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 154_000n,
      tableId: TABLE_BAN9.id,
      tableSessionId: session.id,
      tableNoSnapshot: TABLE_BAN9.tableName,
      tableSession: session,
      table: TABLE_BAN9,
      checkoutLogs: [checkoutLog],
      items: [
        settlementFixtureItem({ productId: 101n, name: '招牌牛肉锅', unitPriceVnd: 77_000n, quantity: 2 }),
      ],
    }),
    settlementFixtureOrder({
      id: 632n,
      orderNo: 'HY-TEST-632',
      createdAt: '2026-08-17T10:37:25.000Z',
      completedAt: '2026-08-17T10:42:15.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 125_000n,
      tableId: TABLE_BAN9.id,
      tableSessionId: session.id,
      tableNoSnapshot: TABLE_BAN9.tableName,
      tableSession: session,
      table: TABLE_BAN9,
      checkoutLogs: [checkoutLog],
      items: [
        settlementFixtureItem({ productId: 102n, name: '水煮鱼', unitPriceVnd: 125_000n, quantity: 1 }),
      ],
    }),
    settlementFixtureOrder({
      id: 633n,
      orderNo: 'HY-TEST-633',
      createdAt: '2026-08-17T10:41:38.000Z',
      completedAt: '2026-08-17T10:42:15.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 30_000n,
      tableId: TABLE_BAN9.id,
      tableSessionId: session.id,
      tableNoSnapshot: TABLE_BAN9.tableName,
      tableSession: session,
      table: TABLE_BAN9,
      checkoutLogs: [checkoutLog],
      items: [
        settlementFixtureItem({ productId: 103n, name: '凉拌黄瓜', unitPriceVnd: 30_000n, quantity: 1 }),
      ],
    }),
  ];
}

/** Session 417 / table 02: 5 child orders, 1,458,000 - 8,000 = 1,450,000. */
export function session417Fixture(): SettlementOrderRow[] {
  const session = closedSession({
    id: 417n,
    closedAt: '2026-08-17T13:41:04.000Z',
    businessDate: '2026-08-17',
    paymentMethod: 'CASH',
    roundingAmountVnd: 8_000n,
  });
  const checkoutLog = {
    originalAmountVnd: '1458000',
    discountAmountVnd: '0',
    roundingAmountVnd: '8000',
    finalPayableAmountVnd: '1450000',
    payableAmountVnd: '1450000',
    paymentMethod: 'CASH',
  };
  const rows: Array<{ id: bigint; orderNo: string; total: bigint; items: Array<{ productId: bigint; name: string; unit: bigint; qty: number }> }> = [
    { id: 630n, orderNo: 'HY-TEST-630', total: 598_000n, items: [{ productId: 201n, name: '烤羊排', unit: 299_000n, qty: 2 }] },
    { id: 631n, orderNo: 'HY-TEST-631', total: 540_000n, items: [{ productId: 202n, name: '大盘鸡', unit: 270_000n, qty: 2 }] },
    { id: 646n, orderNo: 'HY-TEST-646', total: 80_000n, items: [{ productId: 203n, name: '蒜蓉青菜', unit: 80_000n, qty: 1 }] },
    { id: 648n, orderNo: 'HY-TEST-648', total: 60_000n, items: [{ productId: 204n, name: '米饭', unit: 10_000n, qty: 6 }] },
    { id: 652n, orderNo: 'HY-TEST-652', total: 180_000n, items: [{ productId: 205n, name: '烤鱼', unit: 180_000n, qty: 1 }] },
  ];
  return rows.map((row) =>
    settlementFixtureOrder({
      id: row.id,
      orderNo: row.orderNo,
      createdAt: '2026-08-17T10:19:21.000Z',
      completedAt: '2026-08-17T13:41:04.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: row.total,
      tableId: TABLE_02.id,
      tableSessionId: session.id,
      tableNoSnapshot: TABLE_02.tableName,
      tableSession: session,
      table: TABLE_02,
      checkoutLogs: [checkoutLog],
      items: row.items.map((item) =>
        settlementFixtureItem({
          productId: item.productId,
          name: item.name,
          unitPriceVnd: item.unit,
          quantity: item.qty,
        }),
      ),
    }),
  );
}

/** Same tableId, two different closed sessions -> two settlements. */
export function sameTableDifferentSessionsFixture(): SettlementOrderRow[] {
  const first = closedSession({
    id: 501n,
    closedAt: '2026-08-17T08:00:00.000Z',
    businessDate: '2026-08-17',
    paymentMethod: 'CASH',
  });
  const second = closedSession({
    id: 502n,
    closedAt: '2026-08-17T11:00:00.000Z',
    businessDate: '2026-08-17',
    paymentMethod: 'BANK_TRANSFER',
  });
  return [
    settlementFixtureOrder({
      id: 701n,
      orderNo: 'HY-TEST-701',
      createdAt: '2026-08-17T07:55:00.000Z',
      completedAt: '2026-08-17T08:00:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 100_000n,
      tableId: 7n,
      tableSessionId: first.id,
      tableNoSnapshot: '07',
      tableSession: first,
      table: { id: 7n, tableNo: '07', tableName: null },
      items: [settlementFixtureItem({ productId: 301n, name: '家常豆腐', unitPriceVnd: 50_000n, quantity: 2 })],
    }),
    settlementFixtureOrder({
      id: 702n,
      orderNo: 'HY-TEST-702',
      createdAt: '2026-08-17T10:55:00.000Z',
      completedAt: '2026-08-17T11:00:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 200_000n,
      tableId: 7n,
      tableSessionId: second.id,
      tableNoSnapshot: '07',
      tableSession: second,
      table: { id: 7n, tableNo: '07', tableName: null },
      items: [settlementFixtureItem({ productId: 302n, name: '红烧肉', unitPriceVnd: 100_000n, quantity: 2 })],
    }),
  ];
}

export function deliveryTwoOrdersFixture(): SettlementOrderRow[] {
  return [
    settlementFixtureOrder({
      id: 801n,
      orderNo: 'HY-TEST-801',
      orderType: 'DELIVERY',
      createdAt: '2026-08-17T09:00:00.000Z',
      completedAt: '2026-08-17T09:40:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 90_000n,
      paymentMethod: 'BANK_TRANSFER',
      items: [settlementFixtureItem({ productId: 401n, name: '牛肉炒饭', unitPriceVnd: 90_000n, quantity: 1 })],
    }),
    settlementFixtureOrder({
      id: 802n,
      orderNo: 'HY-TEST-802',
      orderType: 'DELIVERY',
      createdAt: '2026-08-17T09:30:00.000Z',
      completedAt: '2026-08-17T10:10:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 60_000n,
      paymentMethod: 'CASH',
      items: [settlementFixtureItem({ productId: 402n, name: '蔬菜沙拉', unitPriceVnd: 60_000n, quantity: 1 })],
    }),
  ];
}

export function pickupTwoOrdersFixture(): SettlementOrderRow[] {
  return [
    settlementFixtureOrder({
      id: 811n,
      orderNo: 'HY-TEST-811',
      orderType: 'PICKUP',
      createdAt: '2026-08-17T08:00:00.000Z',
      completedAt: '2026-08-17T08:30:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 45_000n,
      paymentMethod: null,
      items: [settlementFixtureItem({ productId: 411n, name: '鸡蛋炒饭', unitPriceVnd: 45_000n, quantity: 1 })],
    }),
    settlementFixtureOrder({
      id: 812n,
      orderNo: 'HY-TEST-812',
      orderType: 'PICKUP',
      createdAt: '2026-08-17T08:10:00.000Z',
      completedAt: '2026-08-17T08:35:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 35_000n,
      paymentMethod: null,
      items: [settlementFixtureItem({ productId: 412n, name: '酸辣粉', unitPriceVnd: 35_000n, quantity: 1 })],
    }),
  ];
}

export function dineInWithoutSessionFixture(): SettlementOrderRow[] {
  return [
    settlementFixtureOrder({
      id: 821n,
      orderNo: 'HY-TEST-821',
      createdAt: '2026-08-17T06:00:00.000Z',
      completedAt: '2026-08-17T06:20:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 55_000n,
      tableId: null,
      tableSessionId: null,
      tableNoSnapshot: null,
      tableSession: null,
      table: null,
      paymentMethod: 'CASH',
      items: [settlementFixtureItem({ productId: 421n, name: '牛肉面', unitPriceVnd: 55_000n, quantity: 1 })],
    }),
  ];
}

export function cancelledOrderFixture(): SettlementOrderRow[] {
  return [
    settlementFixtureOrder({
      id: 831n,
      orderNo: 'HY-TEST-831',
      status: 'CANCELLED',
      orderType: 'PICKUP',
      createdAt: '2026-08-17T07:00:00.000Z',
      cancelledAt: '2026-08-17T07:15:00.000Z',
      businessDate: '2026-08-17',
      totalAmountVnd: 70_000n,
      paymentMethod: null,
      items: [settlementFixtureItem({ productId: 431n, name: '红烧牛肉', unitPriceVnd: 70_000n, quantity: 1 })],
    }),
  ];
}

export function conflictingCheckoutLogsFixture(): SettlementOrderRow[] {
  const session = closedSession({
    id: 416n,
    closedAt: '2026-08-17T10:00:00.000Z',
    businessDate: '2026-08-17',
    paymentMethod: 'CASH',
    roundingAmountVnd: 5_000n,
  });
  const orders = session415Fixture().map((order) => ({ ...order, id: order.id + 2000n, tableSessionId: session.id, tableSession: session }));
  orders[0] = {
    ...orders[0]!,
    checkoutLogs: [{
      originalAmountVnd: '999999',
      discountAmountVnd: '0',
      roundingAmountVnd: '999',
      finalPayableAmountVnd: '999000',
      payableAmountVnd: '999000',
      paymentMethod: 'CASH',
    }],
  };
  return orders;
}
