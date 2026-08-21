import { OrderStatus } from '@prisma/client';
import {
  buildOverview,
  calculatePercentChange,
  filterAnalyticsDishRows,
  mergeDishRows,
  MerchantAnalyticsService,
  shouldExcludeDishFromAnalytics,
} from './merchant-analytics.service';

describe('MerchantAnalyticsService', () => {
  it('scopes every summary to the authenticated merchant and COMPLETED orders', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n, orderNo: 'T-1', orderType: 'DINE_IN', createdAt: new Date('2026-08-01T03:00:00.000Z'), updatedAt: new Date('2026-08-01T10:00:00.000Z'), businessDate: new Date('2026-08-01T00:00:00.000Z'), completedAt: new Date('2026-08-01T10:00:00.000Z'), totalAmountVnd: 100_000n, itemAmountVnd: 100_000n, deliveryFeeVnd: 0n, paymentMethod: 'CASH', discountPayableRateBps: null, discountAmountVnd: null, roundingAmountVnd: null, tableSessionId: null, tableSession: null, table: null, tableNoSnapshot: null, items: [],
      },
      {
        id: 2n, orderNo: 'T-2', orderType: 'PICKUP', createdAt: new Date('2026-08-07T13:00:00.000Z'), updatedAt: new Date('2026-08-07T20:00:00.000Z'), businessDate: new Date('2026-08-07T00:00:00.000Z'), completedAt: new Date('2026-08-07T20:00:00.000Z'), totalAmountVnd: 200_000n, itemAmountVnd: 200_000n, deliveryFeeVnd: 0n, paymentMethod: 'CASH', discountPayableRateBps: null, discountAmountVnd: null, roundingAmountVnd: null, tableSessionId: null, tableSession: null, table: null, tableNoSnapshot: null, items: [],
      },
      {
        id: 3n, orderNo: 'T-3', orderType: 'DELIVERY', createdAt: new Date('2026-07-31T03:00:00.000Z'), updatedAt: new Date('2026-07-31T10:00:00.000Z'), businessDate: new Date('2026-07-31T00:00:00.000Z'), completedAt: new Date('2026-07-31T10:00:00.000Z'), totalAmountVnd: 100_000n, itemAmountVnd: 100_000n, deliveryFeeVnd: 0n, paymentMethod: 'CASH', discountPayableRateBps: null, discountAmountVnd: null, roundingAmountVnd: null, tableSessionId: null, tableSession: null, table: null, tableNoSnapshot: null, items: [],
      },
    ]);
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
      order: { findMany },
    };
    const service = new MerchantAnalyticsService(prisma as never);

    const result = await service.getAnalytics(42n, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-07',
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({
      merchantId: 42n,
      status: OrderStatus.COMPLETED,
      OR: expect.any(Array),
    }));
    expect(result.overview).toEqual(
      expect.objectContaining({
        revenueVnd: '300000',
        settlementCount: 2,
        averageOrderValueVnd: '150000',
      }),
    );
    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it('uses the canonical creation-time business date for cross-midnight, gap, and exclusive-end analytics', async () => {
    const completed = (id: bigint, createdAt: string, totalAmountVnd: bigint) => ({
      id,
      businessDate: null,
      createdAt: new Date(createdAt),
      completedAt: new Date(createdAt),
      totalAmountVnd,
      items: [],
    });
    const service = new MerchantAnalyticsService({
      merchant: {
        findUnique: jest.fn().mockResolvedValue({
          businessHours: {
            saturday: ['11:00-14:00', '16:00-03:00'],
          },
        }),
      },
        order: {
          findMany: jest.fn().mockResolvedValue([
          completed(1n, '2026-08-15T05:00:00.000Z', 10_000n),
          completed(2n, '2026-08-15T08:00:00.000Z', 20_000n),
          completed(3n, '2026-08-15T19:30:00.000Z', 30_000n),
          completed(4n, '2026-08-15T20:00:00.000Z', 40_000n),
        ]),
      },
    } as never);

    const result = await service.getAnalytics(9n, {
      dateFrom: '2026-08-15',
      dateTo: '2026-08-15',
    });

    expect(result.overview).toEqual(expect.objectContaining({
      settlementCount: 3,
      revenueVnd: '60000',
    }));
    expect(result.trend.find((item) => item.key === '02')).toEqual(
      expect.objectContaining({ settlementCount: 1, revenueVnd: '30000' }),
    );
  });

  it('keeps zero-order averages finite and marks zero baselines as not comparable', () => {
    expect(buildOverview(0, 0n)).toEqual({
      revenueVnd: '0',
      settlementCount: 0,
      averageOrderValueVnd: '0',
    });
    expect(calculatePercentChange(18, 0)).toBeNull();
    expect(calculatePercentChange(120, 100)).toBe(20);
  });

  it('sorts top dishes by total quantity and falls back to snapshot-name keys', () => {
    const result = mergeDishRows(
      [
        {
          dishKey: 'name:历史菜品',
          productId: null,
          name: '历史菜品',
          imageUrl: null,
          quantity: 7n,
          revenueVnd: 210_000n,
        },
        {
          dishKey: 'product:8',
          productId: 8n,
          name: '招牌菜',
          imageUrl: '/uploads/dish.webp',
          quantity: 12n,
          revenueVnd: 360_000n,
        },
      ],
      [
        {
          dishKey: 'product:8',
          productId: 8n,
          name: '招牌菜',
          imageUrl: null,
          quantity: 10n,
          revenueVnd: 300_000n,
        },
      ],
    );

    expect(result.map((item) => item.name)).toEqual(['招牌菜', '历史菜品']);
    expect(result[0]).toEqual(
      expect.objectContaining({ quantity: 12, changePercent: 20 }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        key: 'name:历史菜品',
        productId: null,
        changePercent: null,
      }),
    );
  });

  it('keeps full-order revenue while rice and beverages stay out of dish analytics', async () => {
    const service = new MerchantAnalyticsService({
      merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
      order: { findMany: jest.fn().mockResolvedValue([{
        id: 1n,
        orderNo: 'T-4',
        orderType: 'DINE_IN',
        createdAt: new Date('2026-08-12T03:00:00.000Z'),
        updatedAt: new Date('2026-08-12T10:00:00.000Z'),
        businessDate: new Date('2026-08-12T00:00:00.000Z'),
        completedAt: new Date('2026-08-12T10:00:00.000Z'),
        totalAmountVnd: 150_000n,
        itemAmountVnd: 150_000n,
        deliveryFeeVnd: 0n,
        paymentMethod: 'CASH',
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        tableSessionId: null,
        tableSession: null,
        table: null,
        tableNoSnapshot: null,
        items: [
          { productId: 1n, productNameZhSnapshot: '招牌牛肉锅', imageUrlSnapshot: null, quantity: 5, subtotalVnd: 100_000n, product: { imageUrl: null, category: { nameZh: '热菜', nameVi: 'Mon nong', nameEn: 'Hot dishes' } } },
          { productId: 2n, productNameZhSnapshot: '白饭', imageUrlSnapshot: null, quantity: 20, subtotalVnd: 20_000n, product: { imageUrl: null, category: { nameZh: '米饭类', nameVi: 'Com', nameEn: 'Rice' } } },
          { productId: 3n, productNameZhSnapshot: '冰可乐', imageUrlSnapshot: null, quantity: 30, subtotalVnd: 30_000n, product: { imageUrl: null, category: { nameZh: '饮品与酒水', nameVi: 'Do uong', nameEn: 'Beverages' } } },
        ],
      }]) },
    } as never);

    const result = await service.getAnalytics(9n, {
      dateFrom: '2026-08-12',
      dateTo: '2026-08-12',
    });

    expect(result.overview.revenueVnd).toBe('150000');
    expect(result.topDishes.map((item) => item.name)).toEqual(['招牌牛肉锅']);
    expect(result.overview.topDish?.name).toBe('招牌牛肉锅');
  });

  it('exposes a canonical funds split identical to the business summary basis', async () => {
    const service = new MerchantAnalyticsService({
      merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1n,
            businessDate: new Date('2026-08-12T00:00:00.000Z'),
            createdAt: new Date('2026-08-12T05:00:00.000Z'),
            completedAt: new Date('2026-08-12T05:10:00.000Z'),
            totalAmountVnd: 100_000n,
            paymentMethod: 'CASH',
            discountPayableRateBps: null,
            discountAmountVnd: null,
            roundingAmountVnd: null,
            items: [],
          },
          {
            id: 2n,
            businessDate: new Date('2026-08-12T00:00:00.000Z'),
            createdAt: new Date('2026-08-12T06:00:00.000Z'),
            completedAt: new Date('2026-08-12T06:10:00.000Z'),
            totalAmountVnd: 50_000n,
            paymentMethod: 'BANK_TRANSFER',
            discountPayableRateBps: 5000,
            discountAmountVnd: 5_000n,
            roundingAmountVnd: null,
            items: [],
          },
          {
            id: 3n,
            businessDate: new Date('2026-08-12T00:00:00.000Z'),
            createdAt: new Date('2026-08-12T07:00:00.000Z'),
            completedAt: new Date('2026-08-12T07:10:00.000Z'),
            totalAmountVnd: 30_000n,
            paymentMethod: null,
            discountPayableRateBps: null,
            discountAmountVnd: null,
            roundingAmountVnd: 3_000n,
            items: [],
          },
        ]),
      },
    } as never);

    const result = await service.getAnalytics(9n, {
      dateFrom: '2026-08-12',
      dateTo: '2026-08-12',
    });

    expect(result.overview.funds).toEqual({
      grossAmountVnd: '180000',
      discountAmountVnd: '5000',
      roundingAmountVnd: '3000',
      netSettledAmountVnd: '172000',
      cashRevenueVnd: '100000',
      bankTransferRevenueVnd: '45000',
      unrecordedRevenueVnd: '27000',
    });
    expect(
      BigInt(result.overview.funds.grossAmountVnd) -
      BigInt(result.overview.funds.discountAmountVnd) -
      BigInt(result.overview.funds.roundingAmountVnd),
    ).toBe(BigInt(result.overview.funds.netSettledAmountVnd));
    expect(
      BigInt(result.overview.funds.cashRevenueVnd) +
      BigInt(result.overview.funds.bankTransferRevenueVnd) +
      BigInt(result.overview.funds.unrecordedRevenueVnd),
    ).toBe(BigInt(result.overview.funds.netSettledAmountVnd));
  });

  it('buckets trend and time distribution by settledAt (checkout/completion time)', async () => {
    const service = new MerchantAnalyticsService({
      merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1n,
            businessDate: new Date('2026-08-15T00:00:00.000Z'),
            createdAt: new Date('2026-08-15T16:00:00.000Z'),
            completedAt: new Date('2026-08-15T19:30:00.000Z'),
            totalAmountVnd: 120_000n,
            paymentMethod: 'CASH',
            discountPayableRateBps: null,
            discountAmountVnd: null,
            roundingAmountVnd: null,
            items: [],
          },
        ]),
      },
    } as never);

    const result = await service.getAnalytics(9n, {
      dateFrom: '2026-08-15',
      dateTo: '2026-08-15',
    });

    // Created 23:00 local on 8/15; completed 02:30 local on 8/16. The
    // settlement fact uses settledAt so the transaction lands in the 02:00
    // bucket on the following local weekday, not the creation hour.
    expect(result.trend.find((item) => item.key === '23')).toEqual(
      expect.objectContaining({ settlementCount: 0, revenueVnd: '0' }),
    );
    expect(result.trend.find((item) => item.key === '02')).toEqual(
      expect.objectContaining({ settlementCount: 1, revenueVnd: '120000' }),
    );
    expect(result.timeDistribution.find(
      (item) => item.weekday === 5 && item.startHour === 22,
    )).toEqual(expect.objectContaining({ settlementCount: 0, revenueVnd: '0' }));
    expect(result.timeDistribution.find(
      (item) => item.weekday === 6 && item.startHour === 2,
    )).toEqual(expect.objectContaining({ settlementCount: 1, revenueVnd: '120000' }));
  });

  it('keeps today, custom-range and per-day buckets on the same business-date attribution', async () => {
    const orders = [
      {
        id: 1n,
        businessDate: new Date('2026-08-12T00:00:00.000Z'),
        createdAt: new Date('2026-08-12T05:00:00.000Z'),
        completedAt: new Date('2026-08-12T05:10:00.000Z'),
        totalAmountVnd: 100_000n,
        paymentMethod: 'CASH',
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        items: [],
      },
      {
        id: 2n,
        businessDate: new Date('2026-08-14T00:00:00.000Z'),
        createdAt: new Date('2026-08-14T06:00:00.000Z'),
        completedAt: new Date('2026-08-14T06:10:00.000Z'),
        totalAmountVnd: 50_000n,
        paymentMethod: 'BANK_TRANSFER',
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        items: [],
      },
    ];
    const service = new MerchantAnalyticsService({
      merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: {} }) },
      order: { findMany: jest.fn().mockResolvedValue(orders) },
    } as never);

    const range = await service.getAnalytics(9n, {
      dateFrom: '2026-08-12',
      dateTo: '2026-08-14',
    });
    const day1 = await service.getAnalytics(9n, { dateFrom: '2026-08-12', dateTo: '2026-08-12' });
    const day2 = await service.getAnalytics(9n, { dateFrom: '2026-08-13', dateTo: '2026-08-13' });
    const day3 = await service.getAnalytics(9n, { dateFrom: '2026-08-14', dateTo: '2026-08-14' });

    expect(range.overview.settlementCount).toBe(2);
    expect(range.overview.revenueVnd).toBe('150000');
    expect(range.overview.funds.cashRevenueVnd).toBe('100000');
    expect(range.overview.funds.bankTransferRevenueVnd).toBe('50000');
    expect(range.overview.settlementCount).toBe(
      day1.overview.settlementCount +
      day2.overview.settlementCount +
      day3.overview.settlementCount,
    );
    expect(range.overview.revenueVnd).toBe(String(
      BigInt(day1.overview.revenueVnd) +
      BigInt(day2.overview.revenueVnd) +
      BigInt(day3.overview.revenueVnd),
    ));
    expect(range.trend.find((item) => item.key === '2026-08-12')).toEqual(
      expect.objectContaining({ settlementCount: 1, revenueVnd: '100000' }),
    );
    expect(range.trend.find((item) => item.key === '2026-08-13')).toEqual(
      expect.objectContaining({ settlementCount: 0, revenueVnd: '0' }),
    );
    expect(range.trend.find((item) => item.key === '2026-08-14')).toEqual(
      expect.objectContaining({ settlementCount: 1, revenueVnd: '50000' }),
    );
  });

  it('prevents excluded categories from occupying dish ranking positions', () => {
    const rows = filterAnalyticsDishRows([
      {
        dishKey: 'product:11', productId: 11n, name: '牛肉锅', imageUrl: null,
        categoryNameZh: '招牌菜', quantity: 8n, revenueVnd: 320_000n,
      },
      {
        dishKey: 'product:12', productId: 12n, name: '白饭', imageUrl: null,
        categoryNameZh: '米饭类', quantity: 80n, revenueVnd: 160_000n,
      },
      {
        dishKey: 'product:13', productId: 13n, name: '啤酒', imageUrl: null,
        categoryNameEn: 'Beer and drinks', quantity: 60n, revenueVnd: 600_000n,
      },
    ]);

    expect(mergeDishRows(rows, []).map((item) => item.name)).toEqual(['牛肉锅']);
  });

  it('uses a conservative snapshot-name fallback when historical category data is missing', () => {
    expect(shouldExcludeDishFromAnalytics({ name: 'Com rang', categoryNameZh: null })).toBe(true);
    expect(shouldExcludeDishFromAnalytics({ name: '冰可乐' })).toBe(true);
    expect(shouldExcludeDishFromAnalytics({ name: '白饭', categoryNameZh: '主食' })).toBe(true);
    expect(shouldExcludeDishFromAnalytics({ name: 'Nước suối', categoryNameZh: '其他' })).toBe(true);
    expect(shouldExcludeDishFromAnalytics({ name: 'Nước ép cam' })).toBe(true);
    expect(shouldExcludeDishFromAnalytics({ name: '啤酒鸭' })).toBe(false);
    expect(shouldExcludeDishFromAnalytics({ name: '咖啡排骨' })).toBe(false);
    expect(shouldExcludeDishFromAnalytics({ name: '可乐鸡翅', categoryNameZh: '热菜' })).toBe(false);
    expect(shouldExcludeDishFromAnalytics({ name: '炸小吃', categoryNameZh: '饮品与小吃' })).toBe(false);
    expect(shouldExcludeDishFromAnalytics({ name: '牛肉面', categoryNameEn: 'Rice & Noodles' })).toBe(false);
    expect(() => shouldExcludeDishFromAnalytics({ name: '历史菜品' })).not.toThrow();
  });
});
