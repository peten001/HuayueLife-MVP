import { MerchantAnalyticsService } from './merchant-analytics.service';
import {
  session415Fixture,
  session417Fixture,
} from './__fixtures__/settlement-view.fixture';

describe('Analytics settlement-facts regression (Merchant 11 anonymous shape)', () => {
  function analyticsWithOrders(orders: ReturnType<typeof session415Fixture>) {
    return new MerchantAnalyticsService({
      merchant: {
        findUnique: jest.fn().mockResolvedValue({
          businessHours: {
            monday: ['17:00-02:00'],
            tuesday: ['17:00-02:00'],
            wednesday: ['17:00-02:00'],
            thursday: ['17:00-02:00'],
            friday: ['17:00-02:00'],
            saturday: ['17:00-02:00'],
            sunday: ['17:00-02:00'],
          },
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue(orders),
      },
    } as never);
  }

  it('keeps revenue/funds identical, counts settlements once, and preserves every item', async () => {
    const orders = [...session415Fixture(), ...session417Fixture()];
    const rawOrderCount = orders.length;
    const rawGrossRevenue = orders.reduce(
      (sum, order) => sum + BigInt(order.totalAmountVnd),
      0n,
    );
    // The pre-refactor analytics net = gross - unique session rounding.
    const expectedNetRevenue = rawGrossRevenue - 17_000n;
    const rawItemQuantity = orders.reduce(
      (sum, order) => sum + (order.items ?? []).reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );

    const service = analyticsWithOrders(orders);
    const result = await service.getAnalytics(11n, {
      dateFrom: '2026-08-17',
      dateTo: '2026-08-17',
    });

    // Financial invariants: 8 raw orders -> 2 settlements, revenue unchanged.
    expect(rawOrderCount).toBe(8);
    expect(rawGrossRevenue).toBe(1_767_000n);
    expect(result.overview.settlementCount).toBe(2);
    expect(result.overview.revenueVnd).toBe(expectedNetRevenue.toString());
    expect(result.overview.averageOrderValueVnd).toBe('875000');
    expect(result.overview.funds.roundingAmountVnd).toBe('17000');
    expect(result.overview.funds.discountAmountVnd).toBe('0');
    expect(result.overview.funds.cashRevenueVnd).toBe(expectedNetRevenue.toString());
    expect(result.overview.funds.netSettledAmountVnd).toBe(expectedNetRevenue.toString());
    expect(
      BigInt(result.overview.funds.cashRevenueVnd) +
      BigInt(result.overview.funds.bankTransferRevenueVnd) +
      BigInt(result.overview.funds.unrecordedRevenueVnd),
    ).toBe(BigInt(result.overview.funds.netSettledAmountVnd));

    // Dish metrics stay on raw OrderItems: total qty before == after, and the
    // rice/drink exclusion rule still applies.
    const topQuantity = result.topDishes.reduce(
      (sum, dish) => sum + dish.quantity,
      0,
    );
    expect(rawItemQuantity).toBe(16);
    expect(topQuantity).toBe(10);
    expect(result.topDishes.some((dish) => dish.name.includes('米饭'))).toBe(false);
    expect(result.topDishes[0]!.quantity).toBe(2);
  });
});
