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
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _count: { _all: 2 },
        _sum: { totalAmountVnd: 300_000n },
      })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: { totalAmountVnd: 100_000n },
      });
    const prisma = {
      order: { aggregate },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const service = new MerchantAnalyticsService(prisma as never);

    const result = await service.getAnalytics(42n, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-07',
    });

    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const [call] of aggregate.mock.calls) {
      expect(call.where).toEqual(
        expect.objectContaining({
          merchantId: 42n,
          status: OrderStatus.COMPLETED,
          completedAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      );
      expect(call.where.status).not.toBe(OrderStatus.CANCELLED);
    }
    expect(result.overview).toEqual(
      expect.objectContaining({
        revenueVnd: '300000',
        orderCount: 2,
        averageOrderValueVnd: '150000',
      }),
    );
    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it('keeps zero-order averages finite and marks zero baselines as not comparable', () => {
    expect(buildOverview(0, 0n)).toEqual({
      revenueVnd: '0',
      orderCount: 0,
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
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _count: { _all: 3 },
        _sum: { totalAmountVnd: 150_000n },
      })
      .mockResolvedValueOnce({
        _count: { _all: 0 },
        _sum: { totalAmountVnd: 0n },
      });
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          dishKey: 'product:1', productId: 1n, name: '招牌牛肉锅', imageUrl: null,
          categoryNameZh: '热菜', categoryNameVi: 'Mon nong', categoryNameEn: 'Hot dishes',
          quantity: 5n, revenueVnd: 100_000n,
        },
        {
          dishKey: 'product:2', productId: 2n, name: '白饭', imageUrl: null,
          categoryNameZh: '米饭类', categoryNameVi: 'Com', categoryNameEn: 'Rice',
          quantity: 20n, revenueVnd: 20_000n,
        },
        {
          dishKey: 'product:3', productId: 3n, name: '冰可乐', imageUrl: null,
          categoryNameZh: '饮品与酒水', categoryNameVi: 'Do uong', categoryNameEn: 'Beverages',
          quantity: 30n, revenueVnd: 30_000n,
        },
      ])
      .mockResolvedValueOnce([]);
    const service = new MerchantAnalyticsService({
      order: { aggregate },
      $queryRaw: queryRaw,
    } as never);

    const result = await service.getAnalytics(9n, {
      dateFrom: '2026-08-12',
      dateTo: '2026-08-12',
    });

    expect(result.overview.revenueVnd).toBe('150000');
    expect(result.topDishes.map((item) => item.name)).toEqual(['招牌牛肉锅']);
    expect(result.overview.topDish?.name).toBe('招牌牛肉锅');
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
