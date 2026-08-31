import { PrintJobsService } from './print-jobs.service';

describe('PrintJobsService production notifications', () => {
  const merchantId = 7n;
  const sessionId = 11n;
  const orderId = 21n;
  const rule = {
    id: 31n,
    printerId: 41n,
    receiptTemplateId: 51n,
    receiptType: 'ORDER_CUSTOMER',
    triggerEvent: 'ORDER_ACCEPTED',
    copies: 1,
    priority: 100,
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  };

  it('queues only the current customer delta automatically and advances the item ledger once', async () => {
    const { service, tx } = createHarness();

    await expect(service.enqueueAutomaticProductionTriggersForOrderDelta(tx as never, {
      merchantId,
      orderId,
      orderStatusLogId: 61n,
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
      itemDeltas: [{
        productId: '71',
        quantity: 2,
        remark: null,
        unitPriceVnd: '60000',
      }],
    })).resolves.toEqual([{ id: 81n }]);

    expect(tx.printRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        name: { startsWith: '__ROUTING_NEW_ORDER__:KITCHEN:' },
        autoPrint: true,
      }),
    }));
    expect(tx.printTriggerOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ source: 'AUTOMATIC', orderStatusLogId: 61n })],
    }));
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: 91n },
      data: { productionNotifiedQuantity: 3 },
    });
  });

  it('keeps a customer delta pending when no production route has automatic printing enabled', async () => {
    const { service, tx } = createHarness();
    tx.printRule.findMany.mockResolvedValue([]);

    await expect(service.enqueueAutomaticProductionTriggersForOrderDelta(tx as never, {
      merchantId,
      orderId,
      orderStatusLogId: 62n,
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
      itemDeltas: [{
        productId: '71',
        quantity: 1,
        remark: null,
        unitPriceVnd: '60000',
      }],
    })).resolves.toEqual([]);

    expect(tx.printTriggerOutbox.createMany).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('collects pending items across the table orders without merging their print batches', async () => {
    const { service, prisma, tx } = createHarness();
    jest.spyOn(service, 'processAutomaticTriggerIds').mockResolvedValue([]);
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 101n }])
      .mockResolvedValueOnce([{ id: sessionId, status: 'OPEN', open_table_id: 101n }])
      .mockResolvedValueOnce([
        {
          id: 91n,
          order_id: orderId,
          order_status: 'ACCEPTED',
          product_id: 71n,
          product_name_zh_snapshot: '牛肉粉',
          unit_price_vnd: 60_000n,
          quantity: 3,
          production_notified_quantity: 1,
          remark: null,
        },
        {
          id: 92n,
          order_id: 22n,
          order_status: 'ACCEPTED',
          product_id: 72n,
          product_name_zh_snapshot: '冰咖啡',
          unit_price_vnd: 35_000n,
          quantity: 1,
          production_notified_quantity: 0,
          remark: '少冰',
        },
      ]);
    tx.orderItem.findMany.mockImplementation(({ where }: { where: { orderId: bigint } }) =>
      Promise.resolve(where.orderId === orderId
        ? [{
            id: 91n,
            productId: 71n,
            unitPriceVnd: 60_000n,
            remark: null,
            quantity: 3,
            productionNotifiedQuantity: 1,
          }]
        : [{
            id: 92n,
            productId: 72n,
            unitPriceVnd: 35_000n,
            remark: '少冰',
            quantity: 1,
            productionNotifiedQuantity: 0,
          }]),
    );
    tx.orderStatusLog.create
      .mockResolvedValueOnce({ id: 61n })
      .mockResolvedValueOnce({ id: 62n });
    tx.printTriggerOutbox.findMany
      .mockResolvedValueOnce([{ id: 81n }])
      .mockResolvedValueOnce([{ id: 82n }]);

    await expect(service.notifyTableSessionProduction({
      merchantId,
      tableSessionId: sessionId,
      createdByStaffId: 3n,
      requestKey: 'notify_12345678',
    })).resolves.toEqual({
      notification: {
        status: 'UP_TO_DATE',
        pendingItemQuantity: 0,
        pendingOrderCount: 0,
        configuredDestinationCount: 1,
      },
      queuedItemQuantity: 3,
      queuedOrderCount: 2,
      queuedDestinationCount: 2,
      idempotentReplay: false,
    });

    expect(tx.orderStatusLog.create).toHaveBeenCalledTimes(2);
    expect(tx.orderStatusLog.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        orderId,
        action: 'TABLE_SESSION_PRODUCTION_NOTIFIED',
        requestKey: 'notify_12345678',
        metadata: expect.objectContaining({
          printDeltaItems: [expect.objectContaining({ productId: '71', quantity: 2 })],
        }),
      }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        orderId: 22n,
        metadata: expect.objectContaining({
          printDeltaItems: [expect.objectContaining({ productId: '72', quantity: 1 })],
        }),
      }),
    }));
    expect(tx.printTriggerOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ source: 'MANUAL', createdByStaffId: 3n })],
    }));
    expect(service.processAutomaticTriggerIds).toHaveBeenCalledWith([81n, 82n]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('replays the same cashier request without creating a second production intent', async () => {
    const { service, tx } = createHarness();
    jest.spyOn(service, 'processAutomaticTriggerIds').mockResolvedValue([]);
    tx.orderStatusLog.findMany.mockResolvedValue([{ id: 61n }]);

    await expect(service.notifyTableSessionProduction({
      merchantId,
      tableSessionId: sessionId,
      createdByStaffId: 3n,
      requestKey: 'notify_12345678',
    })).resolves.toEqual(expect.objectContaining({
      queuedItemQuantity: 0,
      queuedDestinationCount: 1,
      idempotentReplay: true,
    }));

    expect(tx.orderStatusLog.create).not.toHaveBeenCalled();
    expect(tx.printTriggerOutbox.createMany).not.toHaveBeenCalled();
    expect(service.processAutomaticTriggerIds).toHaveBeenCalledWith([81n]);
  });

  function createHarness() {
    const orderItem = {
      id: 91n,
      productId: 71n,
      unitPriceVnd: 60_000n,
      remark: null,
      quantity: 3,
      productionNotifiedQuantity: 1,
    };
    const tx = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', printingEnabled: true }),
      },
      merchantStaff: {
        findFirst: jest.fn().mockResolvedValue({ id: 3n }),
      },
      tableSession: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: sessionId, tableId: 101n, status: 'OPEN', openTableId: 101n })
          .mockResolvedValue({
            status: 'OPEN',
            orders: [{
              id: orderId,
              items: [{ quantity: 3, productionNotifiedQuantity: 3 }],
            }],
          }),
      },
      printRule: {
        findMany: jest.fn().mockResolvedValue([rule]),
        count: jest.fn().mockResolvedValue(1),
      },
      printTriggerOutbox: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 81n }]),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([orderItem]),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatusLog: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 61n }),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 101n }])
        .mockResolvedValueOnce([{ id: sessionId, status: 'OPEN', open_table_id: 101n }])
        .mockResolvedValueOnce([{
          id: 91n,
          order_id: orderId,
          order_status: 'ACCEPTED',
          product_id: 71n,
          product_name_zh_snapshot: '牛肉粉',
          unit_price_vnd: 60_000n,
          quantity: 3,
          production_notified_quantity: 1,
          remark: null,
        }]),
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
      assertMerchantAutomaticCreationEnabled: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PrintJobsService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        taskCenterEnabled: jest.fn(() => true),
      } as never,
      {} as never,
      {} as never,
      settings as never,
      {} as never,
      { resolveCurrentOrderCustomer: jest.fn() } as never,
      undefined,
    );
    return { service, prisma, tx };
  }
});
