import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';

describe('OrdersService dine-in auto acceptance', () => {
  function buildService(orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY') {
    const storedOrder = {
      id: 91n,
      merchantId: 7n,
      orderType,
      orderNo: 'HY20260724A091',
      createdAt: new Date('2026-07-24T08:00:00.000Z'),
      readyAt: null,
      createdByStaffId: null,
      status: orderType === 'DINE_IN' ? 'ACCEPTED' : 'PENDING_ACCEPTANCE',
      acceptedAt: orderType === 'DINE_IN' ? new Date() : null,
      statusLogs: [{ id: 701n }],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(storedOrder),
        create: jest.fn().mockResolvedValue(storedOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { subtotalVnd: 3000n } }),
      },
      orderStatusLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 702n }),
      },
      cart: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orderStatusLog: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const tableSessions = {
      getOrCreateOpenSession: jest.fn().mockResolvedValue({ id: 11n, created: true }),
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([{ id: 801n }]),
      enqueueAutomaticProductionTriggersForOrderDelta: jest.fn().mockResolvedValue([{ id: 801n }]),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([]),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      { printOrder: jest.fn().mockResolvedValue({}) } as never,
      tableSessions as never,
      { assertOrderingEnabled: jest.fn() } as never,
      { legacyPrintingEnabled: jest.fn(() => false) } as never,
      { assertValid: jest.fn().mockResolvedValue({ staffRole: null }) } as never,
      {} as never,
      printJobs as never,
    );
    Object.defineProperty(service, 'validateAndPrice', {
      value: jest.fn().mockResolvedValue({
        cartId: 31n,
        merchant: { id: 7n, nameZh: 'Test merchant' },
        table: orderType === 'DINE_IN' ? { id: 11n } : null,
        items: [41n, 42n, 43n].map((id) => ({
          product: { id, nameZh: `Test item ${id.toString()}`, priceVnd: 1000n },
          quantity: 1,
          subtotalVnd: 1000n,
        })),
        itemAmountVnd: 3000n,
        deliveryFeeVnd: 0n,
        totalAmountVnd: 3000n,
      }),
    });
    return { service, tx, prisma, printJobs, storedOrder };
  }

  it('creates a QR dine-in order as ACCEPTED with SYSTEM audit and one print event', async () => {
    const { service, tx, printJobs } = buildService('DINE_IN');

    await service.create(5n, 'dinein_123456', { orderType: 'DINE_IN' } as never);

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACCEPTED',
          acceptedAt: expect.any(Date),
          statusLogs: {
            create: expect.objectContaining({
              fromStatus: null,
              toStatus: 'ACCEPTED',
              operatorType: 'SYSTEM',
              operatorUserId: 5n,
              action: 'DINE_IN_AUTO_ACCEPTED',
              requestKey: 'dinein_123456',
              metadata: expect.objectContaining({ printDeltaItems: expect.any(Array) }),
            }),
          },
        }),
      }),
    );
    expect(tx.order.create.mock.calls[0]?.[0].data.items.create).toHaveLength(3);
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(printJobs.enqueueAutomaticProductionTriggersForOrderDelta).toHaveBeenCalledTimes(1);
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([801n]);
  });

  it.each(['PICKUP', 'DELIVERY'] as const)(
    'keeps %s customer orders pending acceptance',
    async (orderType) => {
      const { service, tx, printJobs } = buildService(orderType);

      await service.create(5n, `pickup_${orderType.toLowerCase()}`, { orderType } as never);

      expect(tx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_ACCEPTANCE' }),
        }),
      );
      expect(tx.order.create.mock.calls[0]?.[0].data).not.toHaveProperty('acceptedAt');
      expect(printJobs.enqueueAutomaticTriggersForOrderTransition).not.toHaveBeenCalled();
      expect(printJobs.enqueueAutomaticProductionTriggersForOrderDelta).not.toHaveBeenCalled();
    },
  );

  it('reuses the same active QR Order for the same authenticated user and prints only the append event', async () => {
    const { service, tx, printJobs } = buildService('DINE_IN');
    tx.$queryRaw.mockResolvedValue([{ id: 91n, status: 'ACCEPTED', user_id: 5n }]);
    tx.orderItem.findMany.mockResolvedValue([{ id: 601n, productId: 41n, unitPriceVnd: 1000n, quantity: 1, remark: null }]);

    await service.create(5n, 'dinein_append1', { orderType: 'DINE_IN' } as never);

    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 601n },
      data: expect.objectContaining({ quantity: 2, subtotalVnd: 2000n }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 91n,
        action: 'DINE_IN_CUSTOMER_ITEMS_ADDED',
        requestKey: 'dinein_append1',
        metadata: expect.objectContaining({ reusedOrder: true, printDeltaItems: expect.any(Array) }),
      }),
    }));
    expect(printJobs.enqueueAutomaticProductionTriggersForOrderDelta).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId: 91n,
        orderStatusLogId: 702n,
        itemDeltas: expect.any(Array),
      }),
    );
  });

  it('does not merge QR orders from different authenticated users', async () => {
    const { service, tx } = buildService('DINE_IN');
    tx.$queryRaw.mockResolvedValue([{ id: 90n, status: 'ACCEPTED', user_id: 4n }]);

    await service.create(5n, 'dinein_user05', { orderType: 'DINE_IN' } as never);

    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('reuses and auto-accepts a legacy pending QR Order for the same user', async () => {
    const { service, tx } = buildService('DINE_IN');
    tx.$queryRaw.mockResolvedValue([{
      id: 91n,
      status: 'PENDING_ACCEPTANCE',
      user_id: 5n,
      item_amount_vnd: 1000n,
    }]);

    await service.create(5n, 'dinein_pending1', { orderType: 'DINE_IN' } as never);

    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 91n },
      data: expect.objectContaining({ status: 'ACCEPTED', acceptedAt: expect.any(Date) }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fromStatus: 'PENDING_ACCEPTANCE',
        toStatus: 'ACCEPTED',
        metadata: expect.objectContaining({ autoAcceptedPendingOrder: true }),
      }),
    }));
  });

  it('restores a cancelled zero-amount QR Order but never revives a non-empty cancellation', async () => {
    const reusable = buildService('DINE_IN');
    reusable.tx.$queryRaw.mockResolvedValue([{
      id: 91n,
      status: 'CANCELLED',
      user_id: 5n,
      item_amount_vnd: 0n,
    }]);

    await reusable.service.create(5n, 'dinein_restore1', { orderType: 'DINE_IN' } as never);

    expect(reusable.tx.order.create).not.toHaveBeenCalled();
    expect(reusable.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 91n },
      data: expect.objectContaining({ status: 'ACCEPTED', cancelledAt: null, cancelReason: null }),
    }));

    const unsafe = buildService('DINE_IN');
    unsafe.tx.$queryRaw.mockResolvedValue([{
      id: 90n,
      status: 'CANCELLED',
      user_id: 5n,
      item_amount_vnd: 1000n,
    }]);
    await unsafe.service.create(5n, 'dinein_restore2', { orderType: 'DINE_IN' } as never);
    expect(unsafe.tx.order.create).toHaveBeenCalledTimes(1);
    expect(unsafe.tx.order.update).not.toHaveBeenCalled();
  });

  it('replays an appended-cart request from its audit key without another transaction', async () => {
    const { service, prisma, storedOrder } = buildService('DINE_IN');
    prisma.orderStatusLog.findFirst.mockResolvedValue({ orderId: storedOrder.id });
    prisma.order.findFirst.mockResolvedValue(storedOrder);

    await expect(service.create(5n, 'dinein_replay1', { orderType: 'DINE_IN' } as never))
      .resolves.toMatchObject({ id: 91n });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retries a transient MySQL write conflict without duplicating the request', async () => {
    const { service, prisma } = buildService('DINE_IN');
    const transaction = prisma.$transaction.getMockImplementation();
    prisma.$transaction
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
        'write conflict',
        { code: 'P2034', clientVersion: '5.22.0' },
      ))
      .mockImplementation(transaction);

    await expect(service.create(
      5n,
      'dinein_retry01',
      { orderType: 'DINE_IN' } as never,
    )).resolves.toMatchObject({ id: 91n });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
