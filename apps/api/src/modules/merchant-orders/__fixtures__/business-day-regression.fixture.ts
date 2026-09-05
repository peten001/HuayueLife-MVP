import {
  OrderStatus,
  OrderType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import {
  businessDayWindow,
  instantForBusinessDateMinute,
  normalizeBusinessHours,
} from '../../../common/utils/merchant-hours';

/**
 * Anonymous regression fixtures for the Business Day full-chain consistency
 * work. All merchants, orders, sessions and amounts are synthetic; no
 * production privacy data is copied.
 */

export const REGRESSION_SCHEDULE = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((weekday) => [weekday, ['15:00-01:00']]),
) as Record<string, string[]>;

export type FixtureSession = {
  openedAt?: Date;
  openedBusinessDate?: Date | null;
  id: bigint;
  status: 'CLOSED' | 'OPEN';
  discountAmountVnd: bigint | null;
  roundingAmountVnd: bigint | null;
  paymentMethod: PaymentMethod | null;
};

export type FixtureOrder = {
  id: bigint;
  status: OrderStatus;
  orderType: OrderType;
  createdAt: Date;
  completedAt: Date | null;
  businessDate: Date | null;
  totalAmountVnd: bigint;
  itemAmountVnd: bigint;
  deliveryFeeVnd: bigint;
  discountPayableRateBps: number | null;
  discountAmountVnd: bigint | null;
  roundingAmountVnd: bigint | null;
  paymentMethod: PaymentMethod | null;
  tableSessionId: bigint | null;
  tableSession: FixtureSession | null;
  items: Array<{
    productId: bigint | null;
    productNameZhSnapshot: string;
    imageUrlSnapshot: string | null;
    quantity: number;
    subtotalVnd: bigint;
    product: {
      nameZh: string;
      nameVi: string | null;
      imageUrl: string | null;
      category: {
        nameZh: string;
        nameVi: string | null;
        nameEn: string | null;
      } | null;
    } | null;
  }>;
  printLogs: Array<{ status: string }>;
};

export function fixtureOrder(
  input: {
    id: bigint;
    createdAt: string;
    completedAt?: string;
    status?: OrderStatus;
    totalAmountVnd: bigint;
    discountPayableRateBps?: number | null;
    discountAmountVnd?: bigint | null;
    roundingAmountVnd?: bigint | null;
    paymentMethod?: PaymentMethod | null;
    tableSessionId?: bigint | null;
    tableSession?: FixtureSession | null;
    businessDate?: string | null;
  },
): FixtureOrder {
  return {
    id: input.id,
    status: input.status ?? 'COMPLETED',
    orderType: 'DINE_IN',
    createdAt: new Date(input.createdAt),
    completedAt: input.completedAt ? new Date(input.completedAt) : null,
    businessDate: input.businessDate
      ? new Date(`${input.businessDate}T00:00:00.000Z`)
      : null,
    totalAmountVnd: input.totalAmountVnd,
    itemAmountVnd: input.totalAmountVnd,
    deliveryFeeVnd: 0n,
    discountPayableRateBps: input.discountPayableRateBps ?? null,
    discountAmountVnd: input.discountAmountVnd ?? null,
    roundingAmountVnd: input.roundingAmountVnd ?? null,
    paymentMethod: input.paymentMethod ?? null,
    tableSessionId: input.tableSessionId ?? null,
    tableSession: input.tableSession ?? null,
    items: [{
      productId: input.id,
      productNameZhSnapshot: `匿名菜品-${input.id}`,
      imageUrlSnapshot: null,
      quantity: 1,
      subtotalVnd: input.totalAmountVnd,
      product: {
        nameZh: `匿名菜品-${input.id}`,
        nameVi: null,
        imageUrl: null,
        category: { nameZh: '热菜', nameVi: 'Món nóng', nameEn: 'Hot dishes' },
      },
    }],
    printLogs: [],
  };
}

/**
 * The 6 / 4 / 4 historical discrepancy.
 *
 * Business date 2026-08-14, schedule 15:00-01:00:
 * - completedAt-window scope (old Business Summary) counts 6;
 * - createdAt natural-day scope (old Admin Orders) counts 4;
 * - completedAt natural-day scope (old Analytics) counts 4.
 *
 * The canonical creation-time BusinessDateOrderSet counts 7, because the
 * 00:55-created order was still inside the 8/14 accounting window even though
 * it completed after 01:00.
 */
export const SCOPE_SPLIT_FIXTURE = [
  fixtureOrder({ id: 1n, createdAt: '2026-08-14T09:00:00.000Z', completedAt: '2026-08-14T10:00:00.000Z', totalAmountVnd: 100_000n }),
  fixtureOrder({ id: 2n, createdAt: '2026-08-14T11:00:00.000Z', completedAt: '2026-08-14T12:00:00.000Z', totalAmountVnd: 120_000n }),
  fixtureOrder({ id: 3n, createdAt: '2026-08-14T13:00:00.000Z', completedAt: '2026-08-14T14:00:00.000Z', totalAmountVnd: 150_000n }),
  fixtureOrder({ id: 4n, createdAt: '2026-08-14T14:30:00.000Z', completedAt: '2026-08-14T15:00:00.000Z', totalAmountVnd: 80_000n }),
  fixtureOrder({ id: 5n, createdAt: '2026-08-14T17:05:00.000Z', completedAt: '2026-08-14T17:20:00.000Z', totalAmountVnd: 200_000n }),
  fixtureOrder({ id: 6n, createdAt: '2026-08-14T17:10:00.000Z', completedAt: '2026-08-14T17:40:00.000Z', totalAmountVnd: 180_000n }),
  fixtureOrder({ id: 7n, createdAt: '2026-08-14T17:55:00.000Z', completedAt: '2026-08-14T18:10:00.000Z', totalAmountVnd: 90_000n }),
  fixtureOrder({ id: 8n, createdAt: '2026-08-14T18:20:00.000Z', completedAt: '2026-08-14T18:40:00.000Z', totalAmountVnd: 60_000n }),
] satisfies FixtureOrder[];

export function legacyCompletedAtWindowCount(
  orders: FixtureOrder[],
  businessDate: string,
) {
  const schedule = normalizeBusinessHours(REGRESSION_SCHEDULE);
  const window = businessDayWindow(schedule, businessDate);
  return orders.filter((order) =>
    order.completedAt &&
    window &&
    order.completedAt.getTime() >= window.start.getTime() &&
    order.completedAt.getTime() < window.end.getTime(),
  ).length;
}

export function legacyCreatedAtNaturalDayCount(
  orders: FixtureOrder[],
  businessDate: string,
) {
  const start = instantForBusinessDateMinute(businessDate, 0);
  const end = instantForBusinessDateMinute(
    businessDate,
    24 * 60,
  );
  return orders.filter((order) =>
    order.createdAt.getTime() >= start.getTime() &&
    order.createdAt.getTime() < end.getTime(),
  ).length;
}

export function legacyCompletedAtNaturalDayCount(
  orders: FixtureOrder[],
  businessDate: string,
) {
  const start = instantForBusinessDateMinute(businessDate, 0);
  const end = instantForBusinessDateMinute(
    businessDate,
    24 * 60,
  );
  return orders.filter((order) =>
    order.completedAt &&
    order.completedAt.getTime() >= start.getTime() &&
    order.completedAt.getTime() < end.getTime(),
  ).length;
}

/**
 * The gross-vs-net revenue discrepancy: Analytics used pre-rounding totals
 * while Business Summary used the session net, so the two revenue numbers
 * differed by exactly the rounding amount.
 */
export const ROUNDING_DELTA_FIXTURE: FixtureOrder[] = [
  fixtureOrder({
    id: 11n,
    createdAt: '2026-08-15T09:00:00.000Z',
    completedAt: '2026-08-15T17:30:00.000Z',
    totalAmountVnd: 500_000n,
    paymentMethod: 'CASH',
    tableSessionId: 21n,
    tableSession: {
      id: 21n,
      status: 'CLOSED',
      discountAmountVnd: 0n,
      roundingAmountVnd: 21_000n,
      paymentMethod: 'CASH',
    },
  }),
  fixtureOrder({
    id: 12n,
    createdAt: '2026-08-15T17:00:00.000Z',
    completedAt: '2026-08-15T17:30:00.000Z',
    totalAmountVnd: 300_000n,
    paymentMethod: 'CASH',
    tableSessionId: 21n,
    tableSession: {
      id: 21n,
      status: 'CLOSED',
      discountAmountVnd: 0n,
      roundingAmountVnd: 21_000n,
      paymentMethod: 'CASH',
    },
  }),
];

/**
 * Full contract fixture for business date 2026-08-15 (Saturday, 15:00-01:00).
 * Covers creation-time snapshot, legacy NULL, cross-midnight completion,
 * gap-period orders, closed-session rounding, order-level discount/rounding,
 * CASH / BANK_TRANSFER / NULL payment, and out-of-scope rows.
 */
export function contractFixture(): FixtureOrder[] {
  const session = (id: bigint): FixtureSession => ({
    id,
    status: 'CLOSED',
    discountAmountVnd: 0n,
    roundingAmountVnd: 10_000n,
    paymentMethod: 'CASH',
  });
  return [
    fixtureOrder({
      id: 101n,
      createdAt: '2026-08-15T09:00:00.000Z',
      completedAt: '2026-08-15T17:30:00.000Z',
      totalAmountVnd: 150_000n,
      paymentMethod: 'CASH',
      tableSessionId: 201n,
      tableSession: session(201n),
    }),
    fixtureOrder({
      id: 102n,
      createdAt: '2026-08-15T17:00:00.000Z',
      completedAt: '2026-08-15T17:30:00.000Z',
      totalAmountVnd: 60_000n,
      paymentMethod: 'CASH',
      tableSessionId: 201n,
      tableSession: session(201n),
    }),
    fixtureOrder({
      id: 103n,
      createdAt: '2026-08-15T09:30:00.000Z',
      completedAt: '2026-08-15T10:00:00.000Z',
      totalAmountVnd: 100_000n,
      paymentMethod: 'CASH',
      businessDate: '2026-08-15',
    }),
    fixtureOrder({
      id: 104n,
      createdAt: '2026-08-15T16:30:00.000Z',
      completedAt: '2026-08-15T17:00:00.000Z',
      totalAmountVnd: 200_000n,
      paymentMethod: 'BANK_TRANSFER',
      discountPayableRateBps: 5000,
      discountAmountVnd: 10_000n,
    }),
    fixtureOrder({
      id: 105n,
      createdAt: '2026-08-15T17:15:00.000Z',
      completedAt: '2026-08-15T17:20:00.000Z',
      totalAmountVnd: 50_000n,
      paymentMethod: null,
      roundingAmountVnd: 5_000n,
    }),
    fixtureOrder({
      id: 106n,
      createdAt: '2026-08-15T06:00:00.000Z',
      completedAt: '2026-08-15T06:30:00.000Z',
      totalAmountVnd: 60_000n,
      paymentMethod: 'CASH',
    }),
    fixtureOrder({
      id: 107n,
      createdAt: '2026-08-15T10:00:00.000Z',
      status: 'ACCEPTED',
      totalAmountVnd: 70_000n,
    }),
    fixtureOrder({
      id: 108n,
      createdAt: '2026-08-15T10:30:00.000Z',
      status: 'CANCELLED',
      totalAmountVnd: 0n,
    }),
    fixtureOrder({
      id: 109n,
      createdAt: '2026-08-15T18:00:00.000Z',
      completedAt: '2026-08-15T18:20:00.000Z',
      totalAmountVnd: 40_000n,
    }),
    fixtureOrder({
      id: 110n,
      createdAt: '2026-08-14T10:00:00.000Z',
      completedAt: '2026-08-14T10:30:00.000Z',
      totalAmountVnd: 33_000n,
      businessDate: '2026-08-14',
    }),
  ];
}

export function asPrismaOrderRow(order: FixtureOrder): Prisma.OrderGetPayload<object> {
  return order as unknown as Prisma.OrderGetPayload<object>;
}
