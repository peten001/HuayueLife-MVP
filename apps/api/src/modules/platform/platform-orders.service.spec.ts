import { PlatformOrdersService } from './platform-orders.service';

describe('PlatformOrdersService action log compatibility', () => {
  it('filters internal action rows and does not select sensitive audit fields', async () => {
    const createdAt = new Date('2026-07-17T00:00:00.000Z');
    const statusLogs = [
      {
        id: 1n,
        fromStatus: null,
        toStatus: 'PENDING_ACCEPTANCE',
        operatorType: 'USER',
        action: null,
        remark: '用户提交订单',
        createdAt,
      },
      ...[
        'MERCHANT_ADD_ITEMS',
        'ORDER_ITEM_DECREASED',
        'ORDER_ITEM_RETURNED',
      ].map((action, index) => ({
        id: BigInt(index + 2),
        fromStatus: 'PENDING_ACCEPTANCE',
        toStatus: 'PENDING_ACCEPTANCE',
        operatorType: 'MERCHANT_STAFF',
        action,
        remark: '内部动作',
        createdAt,
      })),
    ];
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10n,
            orderNo: 'PLATFORM-ORDER-10',
            merchantId: 20n,
            merchant: {
              nameZh: '测试商家',
              city: 'Bac Ninh',
              district: null,
            },
            orderType: 'DINE_IN',
            status: 'PENDING_ACCEPTANCE',
            totalAmountVnd: 100000n,
            contactName: null,
            contactPhone: null,
            table: null,
            tableNoSnapshot: 'A01',
            deliveryAddress: null,
            customerRemark: null,
            cancelReason: null,
            createdAt,
            completedAt: null,
            cancelledAt: null,
            acceptedAt: null,
            readyAt: null,
            items: [],
            statusLogs,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { totalAmountVnd: 100000n },
        }),
      },
    };
    const service = new PlatformOrdersService(prisma as never);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.items[0].statusLogs).toEqual([
      {
        id: '1',
        fromStatus: null,
        toStatus: 'PENDING_ACCEPTANCE',
        operatorType: 'USER',
        remark: '用户提交订单',
        createdAt: createdAt.toISOString(),
      },
    ]);
    const statusLogQuery = prisma.order.findMany.mock.calls[0][0].include
      .statusLogs;
    expect(statusLogQuery.select).not.toHaveProperty('metadata');
    expect(statusLogQuery.select).not.toHaveProperty('requestKey');
  });
});
