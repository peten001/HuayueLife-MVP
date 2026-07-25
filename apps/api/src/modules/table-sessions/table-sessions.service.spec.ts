import { TableSessionsService } from './table-sessions.service';

describe('TableSessionsService checkout', () => {
  it('enqueues the existing COMPLETED print trigger without changing settlement', async () => {
    const merchantId = 7n;
    const staffId = 11n;
    const tableId = 13n;
    const sessionId = 17n;
    const orderId = 19n;
    const statusLogId = 23n;
    const triggerId = 29n;
    const transaction = {
      tableSession: {
        findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: {
        create: jest.fn().mockResolvedValue({ id: statusLogId }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: tableId, status: 'ACTIVE' }])
        .mockResolvedValueOnce([
          {
            id: sessionId,
            merchant_id: merchantId,
            table_id: tableId,
            status: 'OPEN',
            open_table_id: tableId,
            closed_at: null,
            rounding_amount_vnd: 3_000n,
            rounding_applied_by_staff_id: staffId,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: orderId,
            status: 'ACCEPTED',
            order_type: 'DINE_IN',
            total_amount_vnd: 513_000n,
          },
        ]),
    };
    const orderSnapshot = merchantOrderSnapshot({
      id: orderId,
      merchantId,
      tableId,
      tableSessionId: sessionId,
    });
    const prisma = {
      $transaction: jest.fn(
        async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
      order: {
        findMany: jest.fn().mockResolvedValue([orderSnapshot]),
      },
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest
        .fn()
        .mockResolvedValue([{ id: triggerId }]),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([]),
    };
    const service = new TableSessionsService(prisma as never, printJobs as never);
    const snapshot = {
      session: {
        id: sessionId,
        status: 'CLOSED',
        orders: [{ id: orderId, status: 'COMPLETED' }],
      },
    };
    jest.spyOn(service, 'getSessionDetail').mockResolvedValue(snapshot as never);

    await expect(
      service.checkoutSession(merchantId, staffId, sessionId),
    ).resolves.toEqual({ ...snapshot, orders: [orderSnapshot] });

    expect(transaction.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: orderId,
        merchantId,
        tableSessionId: sessionId,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      },
      data: {
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      },
    });
    expect(transaction.order.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty(
      'settlementStatus',
    );
    expect(transaction.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId,
        fromStatus: 'ACCEPTED',
        toStatus: 'COMPLETED',
        operatorType: 'MERCHANT_STAFF',
        operatorStaffId: staffId,
        action: 'TABLE_SESSION_CHECKOUT',
        metadata: {
          tableSessionId: sessionId.toString(),
          originalAmountVnd: '513000',
          roundingAmountVnd: '3000',
          payableAmountVnd: '510000',
        },
      }),
    });
    expect(
      printJobs.enqueueAutomaticTriggersForOrderTransition,
    ).toHaveBeenCalledWith(transaction, {
      merchantId,
      orderId,
      orderStatusLogId: statusLogId,
      orderType: 'DINE_IN',
      status: 'COMPLETED',
    });
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([triggerId]);
    expect(transaction.tableSession.updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, merchantId, status: 'OPEN' },
      data: {
        openTableId: null,
        status: 'CLOSED',
        closedAt: expect.any(Date),
        roundingAmountVnd: 3_000n,
      },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { merchantId, tableSessionId: sessionId },
      include: expect.objectContaining({
        merchant: expect.any(Object),
        user: expect.any(Object),
        table: expect.any(Object),
        items: expect.any(Object),
        statusLogs: expect.any(Object),
        chatConversation: expect.any(Object),
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('rejects an unaccepted order without completing or closing anything', async () => {
    const harness = checkoutHarness([
      { id: 19n, status: 'PENDING_ACCEPTANCE', order_type: 'DINE_IN' },
    ]);

    await expect(
      harness.service.checkoutSession(harness.merchantId, harness.staffId, harness.sessionId),
    ).rejects.toMatchObject({
      response: { code: 'TABLE_SESSION_HAS_UNACCEPTED_ORDERS' },
    });

    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.orderStatusLog.create).not.toHaveBeenCalled();
    expect(harness.transaction.tableSession.updateMany).not.toHaveBeenCalled();
    expect(
      harness.printJobs.enqueueAutomaticTriggersForOrderTransition,
    ).not.toHaveBeenCalled();
  });

  it('rejects a non-dine-in order bound to a table session', async () => {
    const harness = checkoutHarness([
      { id: 19n, status: 'ACCEPTED', order_type: 'DINE_IN' },
      { id: 31n, status: 'PENDING_ACCEPTANCE', order_type: 'PICKUP' },
    ]);

    await expect(
      harness.service.checkoutSession(harness.merchantId, harness.staffId, harness.sessionId),
    ).rejects.toMatchObject({
      response: { code: 'TABLE_SESSION_HAS_NON_DINE_IN_ORDERS' },
    });

    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.tableSession.updateMany).not.toHaveBeenCalled();
  });

  it('releases an empty open table session without creating order side effects', async () => {
    const harness = checkoutHarness([]);
    harness.prisma.order.findMany.mockResolvedValueOnce([]);

    await expect(
      harness.service.checkoutSession(
        harness.merchantId,
        harness.staffId,
        harness.sessionId,
      ),
    ).resolves.toEqual({ ...harness.snapshot, orders: [] });

    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.orderStatusLog.create).not.toHaveBeenCalled();
    expect(
      harness.printJobs.enqueueAutomaticTriggersForOrderTransition,
    ).not.toHaveBeenCalled();
    expect(harness.printJobs.processAutomaticTriggerIds).not.toHaveBeenCalled();
    expect(harness.transaction.tableSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: harness.sessionId,
        merchantId: harness.merchantId,
        status: 'OPEN',
      },
      data: {
        openTableId: null,
        status: 'CLOSED',
        closedAt: expect.any(Date),
        roundingAmountVnd: 0n,
      },
    });
  });

  it('releases a table session containing only cancelled orders without rewriting them', async () => {
    const harness = checkoutHarness([
      { id: 19n, status: 'CANCELLED', order_type: 'DINE_IN' },
      { id: 31n, status: 'CANCELLED', order_type: 'DINE_IN' },
    ]);
    const cancelledSnapshots = [
      { ...harness.orderSnapshot, status: 'CANCELLED' as const },
      { ...harness.orderSnapshot, id: 31n, status: 'CANCELLED' as const },
    ];
    harness.prisma.order.findMany.mockResolvedValueOnce(cancelledSnapshots);

    await expect(
      harness.service.checkoutSession(
        harness.merchantId,
        harness.staffId,
        harness.sessionId,
      ),
    ).resolves.toEqual({ ...harness.snapshot, orders: cancelledSnapshots });

    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.orderStatusLog.create).not.toHaveBeenCalled();
    expect(
      harness.printJobs.enqueueAutomaticTriggersForOrderTransition,
    ).not.toHaveBeenCalled();
    expect(harness.printJobs.processAutomaticTriggerIds).not.toHaveBeenCalled();
    expect(harness.transaction.tableSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: harness.sessionId,
        merchantId: harness.merchantId,
        status: 'OPEN',
      },
      data: {
        openTableId: null,
        status: 'CLOSED',
        closedAt: expect.any(Date),
        roundingAmountVnd: 0n,
      },
    });
  });

  it('does not roll back a committed checkout when immediate print processing fails', async () => {
    const harness = checkoutHarness([
      { id: 19n, status: 'ACCEPTED', order_type: 'DINE_IN' },
    ]);
    harness.printJobs.enqueueAutomaticTriggersForOrderTransition.mockResolvedValueOnce([
      { id: 29n },
    ]);
    harness.printJobs.processAutomaticTriggerIds.mockRejectedValueOnce(
      new Error('connector unavailable'),
    );

    await expect(
      harness.service.checkoutSession(
        harness.merchantId,
        harness.staffId,
        harness.sessionId,
      ),
    ).resolves.toEqual({ ...harness.snapshot, orders: [harness.orderSnapshot] });

    expect(harness.transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 19n, status: 'ACCEPTED' }),
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(harness.transaction.tableSession.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([29n]);
  });

  it('closes and completes an accepted session even after its table is disabled', async () => {
    const harness = checkoutHarness(
      [{ id: 19n, status: 'ACCEPTED', order_type: 'DINE_IN' }],
      'OPEN',
      'DISABLED',
    );

    await expect(
      harness.service.checkoutSession(harness.merchantId, harness.staffId, harness.sessionId),
    ).resolves.toEqual({ ...harness.snapshot, orders: [harness.orderSnapshot] });

    expect(harness.transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 19n, status: 'ACCEPTED' }),
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(harness.transaction.tableSession.updateMany).toHaveBeenCalledWith({
      where: { id: harness.sessionId, merchantId: harness.merchantId, status: 'OPEN' },
      data: {
        openTableId: null,
        status: 'CLOSED',
        closedAt: expect.any(Date),
        roundingAmountVnd: 0n,
      },
    });
  });

  it('returns an already closed disabled-table session without duplicating side effects', async () => {
    const harness = checkoutHarness([], 'CLOSED', 'DISABLED');

    await expect(
      harness.service.checkoutSession(harness.merchantId, harness.staffId, harness.sessionId),
    ).resolves.toEqual({ ...harness.snapshot, orders: [harness.orderSnapshot] });

    expect(harness.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(harness.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(harness.transaction.orderStatusLog.create).not.toHaveBeenCalled();
    expect(harness.transaction.tableSession.updateMany).not.toHaveBeenCalled();
    expect(
      harness.printJobs.enqueueAutomaticTriggersForOrderTransition,
    ).not.toHaveBeenCalled();
    expect(harness.printJobs.processAutomaticTriggerIds).not.toHaveBeenCalled();
  });

  it('still rejects opening a new session on a disabled table', async () => {
    const merchantId = 7n;
    const tableId = 13n;
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: tableId, status: 'DISABLED' }]),
    };
    const prisma = {};
    const printJobs = {};
    const service = new TableSessionsService(prisma as never, printJobs as never);

    await expect(
      service.getOrCreateOpenSession(transaction as never, merchantId, tableId),
    ).rejects.toMatchObject({
      response: { code: 'TABLE_NOT_AVAILABLE' },
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('lets the legacy close endpoint release an unfinished-free disabled table session', async () => {
    const merchantId = 7n;
    const tableId = 13n;
    const sessionId = 17n;
    const transaction = {
      tableSession: {
        findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: tableId, status: 'DISABLED' }])
        .mockResolvedValueOnce([
          {
            id: sessionId,
            merchant_id: merchantId,
            table_id: tableId,
            status: 'OPEN',
            open_table_id: tableId,
            closed_at: null,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const service = new TableSessionsService(prisma as never, {} as never);
    const snapshot = { session: { id: sessionId, status: 'CLOSED' } };
    jest.spyOn(service, 'getSessionDetail').mockResolvedValue(snapshot as never);

    await expect(service.closeSession(merchantId, sessionId)).resolves.toEqual(snapshot);
    expect(transaction.tableSession.updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, merchantId, status: 'OPEN' },
      data: {
        openTableId: null,
        status: 'CLOSED',
        closedAt: expect.any(Date),
      },
    });
  });
});

describe('TableSessionsService rounding', () => {
  it.each([
    {
      label: 'applies',
      enabled: true,
      expectedAmount: 3_000n,
      expectedStaffId: 11n,
    },
    {
      label: 'cancels',
      enabled: false,
      expectedAmount: 0n,
      expectedStaffId: null,
    },
  ])('$label a persisted 513,000 VND table rounding', async ({
    enabled,
    expectedAmount,
    expectedStaffId,
  }) => {
    const merchantId = 7n;
    const staffId = 11n;
    const tableId = 13n;
    const sessionId = 17n;
    const transaction = {
      tableSession: {
        findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId }),
        update: jest.fn().mockResolvedValue({ id: sessionId }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: tableId, status: 'ACTIVE' }])
        .mockResolvedValueOnce([
          {
            id: sessionId,
            merchant_id: merchantId,
            table_id: tableId,
            status: 'OPEN',
            open_table_id: tableId,
            closed_at: null,
            rounding_amount_vnd: enabled ? 3_000n : 0n,
            rounding_applied_by_staff_id: enabled ? staffId : null,
          },
        ])
        .mockResolvedValueOnce([
          {
            status: 'ACCEPTED',
            order_type: 'DINE_IN',
            total_amount_vnd: 513_000n,
          },
        ]),
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const service = new TableSessionsService(prisma as never, {} as never);
    const snapshot = {
      session: {
        id: sessionId,
        roundingApplied: enabled,
        roundingAmountVnd: expectedAmount,
        totalAmountVnd: 513_000n,
        payableAmountVnd: 513_000n - expectedAmount,
      },
    };
    jest.spyOn(service, 'getSessionDetail').mockResolvedValue(snapshot as never);

    await expect(
      service.setRounding(merchantId, staffId, sessionId, enabled),
    ).resolves.toEqual(snapshot);

    expect(transaction.tableSession.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: {
        roundingAmountVnd: expectedAmount,
        roundingAppliedByStaffId: expectedStaffId,
      },
    });
    expect(service.getSessionDetail).toHaveBeenCalledWith(merchantId, sessionId);
  });
});

function checkoutHarness(
  orders: Array<{
    id: bigint;
    status: string;
    order_type: string;
    total_amount_vnd?: bigint;
  }>,
  sessionStatus = 'OPEN',
  tableStatus = 'ACTIVE',
) {
  const merchantId = 7n;
  const staffId = 11n;
  const tableId = 13n;
  const sessionId = 17n;
  const transaction = {
    tableSession: {
      findFirst: jest.fn().mockResolvedValue({ id: sessionId, tableId }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderStatusLog: {
      create: jest.fn().mockResolvedValue({ id: 23n }),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: tableId, status: tableStatus }])
      .mockResolvedValueOnce([
        {
          id: sessionId,
          merchant_id: merchantId,
          table_id: tableId,
          status: sessionStatus,
          open_table_id: sessionStatus === 'OPEN' ? tableId : null,
          closed_at: sessionStatus === 'CLOSED' ? new Date() : null,
          rounding_amount_vnd: 0n,
          rounding_applied_by_staff_id: null,
        },
      ])
      .mockResolvedValueOnce(
        orders.map((order) => ({
          ...order,
          total_amount_vnd: order.total_amount_vnd ?? 50_000n,
        })),
      ),
  };
  const prisma = {
    $transaction: jest.fn(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
    order: {
      findMany: jest.fn(),
    },
  };
  const printJobs = {
    enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([]),
    processAutomaticTriggerIds: jest.fn().mockResolvedValue([]),
  };
  const service = new TableSessionsService(prisma as never, printJobs as never);
  const snapshot = {
    session: { id: sessionId, status: sessionStatus, orders: [] },
  };
  const orderSnapshot = merchantOrderSnapshot({
    id: 19n,
    merchantId,
    tableId,
    tableSessionId: sessionId,
  });
  prisma.order.findMany.mockResolvedValue([orderSnapshot]);
  jest.spyOn(service, 'getSessionDetail').mockResolvedValue(snapshot as never);
  return {
    merchantId,
    staffId,
    sessionId,
    transaction,
    printJobs,
    prisma,
    service,
    snapshot,
    orderSnapshot,
  };
}

function merchantOrderSnapshot(input: {
  id: bigint;
  merchantId: bigint;
  tableId: bigint;
  tableSessionId: bigint;
}) {
  return {
    id: input.id,
    orderNo: 'HY-CHECKOUT-TEST',
    idempotencyKey: 'checkout-test-key',
    userId: 37n,
    createdByStaffId: null,
    merchantId: input.merchantId,
    tableId: input.tableId,
    tableSessionId: input.tableSessionId,
    tableNoSnapshot: 'A01',
    orderType: 'DINE_IN',
    status: 'COMPLETED',
    contactName: null,
    contactPhone: null,
    deliveryAddress: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    customerRemark: null,
    itemAmountVnd: 50000n,
    deliveryFeeVnd: 0n,
    totalAmountVnd: 50000n,
    settlementStatus: 'UNSETTLED',
    acceptedAt: new Date(),
    readyAt: null,
    completedAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    merchant: { id: input.merchantId, nameZh: '测试商家' },
    user: { id: 37n, nickname: '测试顾客', phone: '0900000000' },
    table: { id: input.tableId, tableNo: 'A01', tableName: '一号桌' },
    items: [
      {
        id: 41n,
        orderId: input.id,
        productId: 43n,
        productNameZhSnapshot: '测试菜品',
        imageUrlSnapshot: null,
        unitPriceVnd: 50000n,
        quantity: 1,
        subtotalVnd: 50000n,
        remark: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    statusLogs: [],
    chatConversation: null,
    printLogs: [],
  };
}
