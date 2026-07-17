import { OrderStatus } from '@prisma/client';
import { PlatformUsersService } from './platform-users.service';

describe('PlatformUsersService nullable order owners', () => {
  const user = {
    id: 11n,
    nickname: 'Customer',
    phone: null,
    avatarUrl: null,
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    lastLoginAt: null,
  };

  function createService(input?: {
    allOrders?: Array<Record<string, unknown>>;
    completedOrders?: Array<Record<string, unknown>>;
    cancelledOrders?: Array<Record<string, unknown>>;
    latestOrders?: Array<Record<string, unknown>>;
  }) {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce(input?.allOrders ?? [])
      .mockResolvedValueOnce(input?.completedOrders ?? [])
      .mockResolvedValueOnce(input?.cancelledOrders ?? []);
    const orderFindMany = jest.fn().mockResolvedValue(input?.latestOrders ?? []);
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([user]) },
      order: { groupBy, findMany: orderFindMany },
    };

    return {
      service: new PlatformUsersService(prisma as never),
      groupBy,
      orderFindMany,
    };
  }

  it('keeps customer order statistics unchanged', async () => {
    const { service } = createService({
      allOrders: [
        {
          userId: user.id,
          _count: { _all: 2 },
          _sum: { totalAmountVnd: 120000n },
          _max: { createdAt: new Date('2026-07-16T10:00:00.000Z') },
        },
      ],
      completedOrders: [
        { userId: user.id, _count: { _all: 1 } },
      ],
      cancelledOrders: [
        { userId: user.id, _count: { _all: 1 } },
      ],
      latestOrders: [
        { userId: user.id, merchant: { city: 'Hanoi' } },
      ],
    });

    const result = await service.list({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: user.id.toString(),
        orderCount: 2,
        orderAmount: '120000',
        completedOrderCount: 1,
        canceledOrderCount: 1,
        city: 'Hanoi',
      }),
    );
  });

  it('excludes staff-origin orders from every customer aggregate query', async () => {
    const { service, groupBy, orderFindMany } = createService();

    await service.list({});

    for (const [args] of groupBy.mock.calls) {
      expect(args.where.userId).toEqual({ in: [user.id], not: null });
    }
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: [user.id], not: null } },
      }),
    );
  });

  it('ignores defensive null rows without throwing or assigning them to a customer', async () => {
    const staffAggregate = {
      userId: null,
      _count: { _all: 9 },
      _sum: { totalAmountVnd: 999999n },
      _max: { createdAt: new Date('2026-07-17T12:00:00.000Z') },
    };
    const { service } = createService({
      allOrders: [staffAggregate],
      completedOrders: [
        { userId: null, _count: { _all: 9 }, status: OrderStatus.COMPLETED },
      ],
      cancelledOrders: [
        { userId: null, _count: { _all: 9 }, status: OrderStatus.CANCELLED },
      ],
      latestOrders: [
        { userId: null, merchant: { city: 'Staff order city' } },
      ],
    });

    await expect(service.list({})).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: user.id.toString(),
            orderCount: 0,
            orderAmount: '0',
            completedOrderCount: 0,
            canceledOrderCount: 0,
            city: null,
          }),
        ],
      }),
    );
  });
});
