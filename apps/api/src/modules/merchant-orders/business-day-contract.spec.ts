import { OrderStatus } from '@prisma/client';
import { MerchantAnalyticsService } from './merchant-analytics.service';
import { MerchantOrdersService } from './merchant-orders.service';
import {
  contractFixture,
  FixtureOrder,
  fixtureOrder,
  FixtureSession,
  REGRESSION_SCHEDULE,
} from './__fixtures__/business-day-regression.fixture';

describe('cross-service Business Date contract', () => {
  const merchantRow = {
    id: 7n,
    nameZh: '匿名回归店',
    nameVi: null,
    businessHours: REGRESSION_SCHEDULE,
  };
  const orders = contractFixture();

  function fakePrisma() {
    return {
      merchant: {
        findUnique: jest.fn().mockResolvedValue(merchantRow),
      },
      order: {
        findMany: jest.fn((args: { where?: { status?: string } }) => {
          const { status } = args.where ?? {};
          return Promise.resolve(
            status ? orders.filter((order) => order.status === status) : orders,
          );
        }),
      },
    };
  }

  it('keeps completed counts, revenue and payment split identical across all five queries', async () => {
    const businessDate = '2026-08-15';
    const ordersService = new MerchantOrdersService(
      fakePrisma() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const analyticsService = new MerchantAnalyticsService(
      fakePrisma() as never,
    );

    const summary = await ordersService.businessDaySummary(7n, businessDate);
    const adminSummary = await ordersService.summary(7n, { date: businessDate });
    const adminRows = await ordersService.list(7n, { date: businessDate });
    const adminCompletedRows = await ordersService.list(7n, {
      date: businessDate,
      status: OrderStatus.COMPLETED,
    });
    const analytics = await analyticsService.getAnalytics(7n, {
      dateFrom: businessDate,
      dateTo: businessDate,
    });

    // Count contract.
    expect(summary.orderCount).toBe(6);
    expect(adminSummary.statusBreakdown.COMPLETED).toBe(6);
    expect(adminSummary.COMPLETED.count).toBe(6);
    expect(analytics.overview.orderCount).toBe(6);
    expect(adminCompletedRows).toHaveLength(6);
    expect(adminRows).toHaveLength(8);
    expect(adminSummary.ALL.count).toBe(8);
    expect(adminSummary.DINE_IN.count).toBe(8);

    // Status / type breakdown invariants.
    const statusSum = Object.values(adminSummary.statusBreakdown as Record<string, number>)
      .reduce((sum, count) => sum + count, 0);
    expect(statusSum).toBe(adminSummary.ALL.count);

    // Revenue contract.
    expect(summary.totalRevenueVnd).toBe('595000');
    expect(adminSummary.COMPLETED.amountVnd).toBe('595000');
    expect(analytics.overview.revenueVnd).toBe('595000');

    // Payment split invariant: cash + bank transfer + legacy unrecorded = net.
    const cash = BigInt(summary.cashRevenueVnd);
    const bank = BigInt(summary.bankTransferRevenueVnd);
    const unrecorded = BigInt(summary.unrecordedRevenueVnd);
    expect(cash + bank + unrecorded).toBe(BigInt(summary.totalRevenueVnd));
    expect(cash + bank + unrecorded).toBe(
      BigInt(adminSummary.COMPLETED.amountVnd),
    );
    expect(cash + bank + unrecorded).toBe(
      BigInt(analytics.overview.revenueVnd),
    );

    // Discount / rounding are reported once and match the canonical gross.
    expect(summary.discountAmountVnd).toBe('10000');
    expect(summary.roundingAmountVnd).toBe('15000');
    expect(adminSummary.COMPLETED.discountAmountVnd).toBe('10000');
    expect(adminSummary.COMPLETED.roundingAmountVnd).toBe('15000');
    expect(
      BigInt(summary.totalRevenueVnd) +
      BigInt(summary.discountAmountVnd) +
      BigInt(summary.roundingAmountVnd),
    ).toBe(BigInt(adminSummary.COMPLETED.grossAmountVnd));
  });

  it('lets cashier history and admin rows resolve from the same BusinessDateOrderSet', async () => {
    const service = new MerchantOrdersService(
      fakePrisma() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const rows = await service.list(7n, { date: '2026-08-15' });
    const expected: FixtureOrder[] = [
      orders[0]!, orders[1]!, orders[2]!, orders[3]!,
      orders[4]!, orders[5]!, orders[6]!, orders[7]!,
    ];
    expect(rows).toHaveLength(expected.length);
    expect(new Set(rows.map((order) => order.id))).toEqual(
      new Set(expected.map((order) => order.id)),
    );
  });

  it('attributes one cross-business-date session consistently across summary and business summary', async () => {
    const session: FixtureSession = {
      id: 301n,
      status: 'CLOSED',
      discountAmountVnd: 0n,
      roundingAmountVnd: 1_000n,
      paymentMethod: 'CASH',
    };
    const crossBoundaryOrders: FixtureOrder[] = [
      fixtureOrder({
        id: 301n,
        createdAt: '2026-08-15T17:30:00.000Z',
        completedAt: '2026-08-15T17:40:00.000Z',
        totalAmountVnd: 600_000n,
        paymentMethod: 'CASH',
        tableSessionId: 301n,
        tableSession: session,
      }),
      fixtureOrder({
        id: 302n,
        createdAt: '2026-08-15T18:20:00.000Z',
        completedAt: '2026-08-15T18:30:00.000Z',
        totalAmountVnd: 400_000n,
        paymentMethod: 'CASH',
        tableSessionId: 301n,
        tableSession: session,
      }),
    ];
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue(merchantRow) },
      order: { findMany: jest.fn().mockResolvedValue(crossBoundaryOrders) },
    };
    const service = new MerchantOrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const bd15 = await service.businessDaySummary(7n, '2026-08-15');
    const bd16 = await service.businessDaySummary(7n, '2026-08-16');
    const admin15 = await service.summary(7n, { date: '2026-08-15' });
    const admin16 = await service.summary(7n, { date: '2026-08-16' });

    expect(bd15.orderCount).toBe(1);
    expect(bd16.orderCount).toBe(1);
    expect(admin15.COMPLETED.count).toBe(1);
    expect(admin16.COMPLETED.count).toBe(1);
    expect(bd15.totalRevenueVnd).toBe(admin15.COMPLETED.amountVnd);
    expect(bd16.totalRevenueVnd).toBe(admin16.COMPLETED.amountVnd);
    expect(
      BigInt(bd15.totalRevenueVnd) + BigInt(bd16.totalRevenueVnd),
    ).toBe(999_000n);
    expect(
      BigInt(bd15.roundingAmountVnd) + BigInt(bd16.roundingAmountVnd),
    ).toBe(1_000n);
  });
});
