import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService table ordering and item adjustments', () => {
  const orderResult = { id: 41n, status: 'PENDING_ACCEPTANCE' };
  const sessionResult = { id: 51n, totalAmountVnd: 12000n };

  function buildService(tx: Record<string, unknown>, overrides?: {
    outsideOrder?: unknown;
    creator?: Record<string, unknown>;
    cancellation?: Record<string, unknown>;
    sessionCreateResult?: { id: bigint; created: boolean };
    printJobs?: Record<string, unknown>;
  }) {
    if (!tx.tableSession) {
      tx.tableSession = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
    }
    if (!tx.merchant) {
      tx.merchant = {
        findUnique: jest.fn().mockResolvedValue({
          businessHours: { saturday: ['10:00-22:00'] },
        }),
      };
    }
    if (!tx.orderStatusLog) {
      tx.orderStatusLog = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 700n }),
      };
    } else {
      const statusLogs = tx.orderStatusLog as Record<string, unknown>;
      if (!statusLogs.findFirst) statusLogs.findFirst = jest.fn().mockResolvedValue(null);
    }
    const txOrder = tx.order as Record<string, unknown> | undefined;
    if (txOrder && !txOrder.findFirstOrThrow) {
      txOrder.findFirstOrThrow = jest.fn().mockResolvedValue(
        overrides?.outsideOrder ?? orderResult,
      );
    }
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      order: {
        findFirst: jest.fn().mockResolvedValue(overrides?.outsideOrder ?? orderResult),
        findUnique: jest.fn(),
      },
    };
    const tableSessions = {
      getSessionDetailWithClient: jest
        .fn()
        .mockResolvedValue({ session: sessionResult }),
      getOrCreateOpenSession: jest.fn().mockResolvedValue(
        overrides?.sessionCreateResult ?? { id: sessionResult.id, created: false },
      ),
    };
    const creator = overrides?.creator ?? {
      assertValid: jest.fn().mockResolvedValue({ staffRole: 'STAFF' }),
    };
    const cancellation = overrides?.cancellation ?? {
      cancel: jest.fn().mockResolvedValue({ id: 99n }),
    };
    const printJobs = overrides?.printJobs ?? {
      enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([]),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([]),
    };
    const service = new MerchantOrdersService(
      prisma as never,
      printJobs as never,
      tableSessions as never,
      creator as never,
      cancellation as never,
    );
    return { service, prisma, tableSessions, creator, cancellation, printJobs };
  }

  it('creates a separate staff order with server-side product pricing', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 41n,
          tableSessionId: 51n,
          statusLogs: [{ id: 700n }],
        }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 61n,
            name_zh: '鱼香茄子',
            image_url: null,
            price_vnd: 6000n,
            product_type: 'FOOD',
            status: 'ON_SALE',
            category_active: 1,
          },
        ]),
      tableSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, creator } = buildService(tx);

    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0001',
        items: [{ productId: '61', quantity: 2 }],
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });

    expect(creator.assertValid).toHaveBeenCalledWith(tx, {
      merchantId: 7n,
      userId: null,
      createdByStaffId: 3n,
    });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          createdByStaffId: 3n,
          status: 'ACCEPTED',
          acceptedAt: expect.any(Date),
          merchantId: 7n,
          tableId: 11n,
          tableSessionId: 51n,
          itemAmountVnd: 12000n,
          totalAmountVnd: 12000n,
          items: {
            create: [expect.objectContaining({ unitPriceVnd: 6000n, quantity: 2 })],
          },
          statusLogs: {
            create: expect.arrayContaining([
              expect.objectContaining({
                action: 'MERCHANT_ADD_ITEMS',
                requestKey: 'staff_add_0001',
                fromStatus: null,
                toStatus: 'ACCEPTED',
              }),
            ]),
          },
        }),
      }),
    );
    expect(tx.tableSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 51n,
        OR: [
          { discountPayableRateBps: { not: null } },
          { discountAmountVnd: { not: 0n } },
          { discountAppliedByStaffId: { not: null } },
          { roundingAppliedByStaffId: { not: null } },
          { roundingAmountVnd: { not: 0n } },
        ],
      },
      data: {
        discountPayableRateBps: null,
        discountAmountVnd: 0n,
        discountAppliedByStaffId: null,
        discountAppliedAt: null,
        roundingAmountVnd: 0n,
        roundingAppliedByStaffId: null,
      },
    });
  });

  it('keeps consecutive same-item direct adds in one staff Order pending an explicit production notification', async () => {
    const tableRow = { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' };
    const productRow = {
      id: 61n,
      name_zh: '鱼香茄子',
      image_url: null,
      price_vnd: 6000n,
      product_type: 'FOOD',
      status: 'ON_SALE',
      category_active: 1,
    };
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValueOnce({ id: 41n, tableSessionId: 51n, statusLogs: [{ id: 701n }] }),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 601n, productId: 61n, unitPriceVnd: 6000n, quantity: 1, remark: null }]),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { subtotalVnd: 12000n } }),
      },
      orderStatusLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 702n }),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([tableRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([productRow])
        .mockResolvedValueOnce([tableRow])
        .mockResolvedValueOnce([{ id: 41n, status: 'ACCEPTED', user_id: null, created_by_staff_id: 3n }])
        .mockResolvedValueOnce([productRow]),
      tableSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest.fn()
        .mockResolvedValueOnce([{ id: 801n }])
        .mockResolvedValueOnce([{ id: 802n }]),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([]),
    };
    const { service } = buildService(tx, { printJobs });

    await service.createTableOrder(7n, 3n, 11n, {
      idempotencyKey: 'staff_same_item_0001',
      items: [{ productId: '61', quantity: 1 }],
    });
    await service.createTableOrder(7n, 3n, 11n, {
      idempotencyKey: 'staff_same_item_0002',
      items: [{ productId: '61', quantity: 1 }],
    });

    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.order.create.mock.calls[0]?.[0].data.idempotencyKey).toBe('staff_same_item_0001');
    expect(tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 601n },
      data: { quantity: 2, subtotalVnd: 12000n },
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 41n,
        action: 'MERCHANT_ADD_ITEMS',
        requestKey: 'staff_same_item_0002',
        metadata: expect.objectContaining({ reusedOrder: true, printDeltaItems: expect.any(Array) }),
      }),
    }));
    expect(printJobs.enqueueAutomaticTriggersForOrderTransition).not.toHaveBeenCalled();
    expect(printJobs.processAutomaticTriggerIds).not.toHaveBeenCalled();
  });

  it('returns the existing add-on order for the same staff idempotency key', async () => {
    const tx = {
      order: {
        findUnique: jest.fn(),
      },
      orderStatusLog: {
        findFirst: jest.fn().mockResolvedValue({
          metadata: { items: [{ productId: '61', quantity: 2, remark: null }] },
          order: { id: 41n, tableId: 11n, tableSessionId: 51n },
        }),
      },
      $queryRaw: jest.fn(),
    };
    const { service } = buildService(tx);
    await service.createTableOrder(7n, 3n, 11n, {
      idempotencyKey: 'staff_add_0001',
      items: [{ productId: '61', quantity: 2 }],
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects reusing an add-order idempotency key with different items', async () => {
    const tx = {
      order: {
        findUnique: jest.fn(),
      },
      orderStatusLog: {
        findFirst: jest.fn().mockResolvedValue({
          metadata: { items: [{ productId: '61', quantity: 2, remark: null }] },
          order: { id: 41n, tableId: 11n, tableSessionId: 51n },
        }),
      },
      $queryRaw: jest.fn(),
    };
    const { service } = buildService(tx);
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0001',
        items: [{ productId: '61', quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
  });

  it('auto-opens a table session for open-only staff ordering', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([]),
    };
    const { service, tableSessions } = buildService(tx, {
      sessionCreateResult: { id: sessionResult.id, created: true },
    });
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0002',
        items: [],
      }),
    ).resolves.toEqual({ order: null, session: sessionResult });
    expect(tableSessions.getOrCreateOpenSession).toHaveBeenCalledWith(tx, 7n, 11n);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('opens a new session and creates one order containing the whole first A/B/C batch', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 41n,
          tableSessionId: 51n,
          statusLogs: [{ id: 701n }],
        }),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([
          { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([61n, 62n, 63n].map((id) => ({
          id,
          name_zh: `菜品${id.toString()}`,
          image_url: null,
          price_vnd: 6000n,
          product_type: 'FOOD',
          status: 'ON_SALE',
          category_active: 1,
        }))),
    };
    const { service } = buildService(tx, {
      sessionCreateResult: { id: sessionResult.id, created: true },
    });
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0005',
        items: [
          { productId: '61', quantity: 1 },
          { productId: '62', quantity: 1 },
          { productId: '63', quantity: 1 },
        ],
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tableSessionId: sessionResult.id,
          items: {
            create: [
              expect.objectContaining({ productId: 61n, quantity: 1 }),
              expect.objectContaining({ productId: 62n, quantity: 1 }),
              expect.objectContaining({ productId: 63n, quantity: 1 }),
            ],
          },
        }),
      }),
    );
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });

  it('rejects open-only ordering when a session is already open', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
      ]).mockResolvedValueOnce([]),
    };
    const { service } = buildService(tx);
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0003',
        items: [],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TABLE_ALREADY_OPEN' }),
    });
  });

  it('rolls back if order creation fails after opening a new session', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(new Error('db create failed')),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 61n,
            name_zh: '鱼香茄子',
            image_url: null,
            price_vnd: 6000n,
            product_type: 'FOOD',
            status: 'ON_SALE',
            category_active: 1,
          },
        ]),
    };
    const { service } = buildService(tx, {
      sessionCreateResult: { id: sessionResult.id, created: true },
    });
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0004',
        items: [{ productId: '61', quantity: 2 }],
      }),
    ).rejects.toThrow('db create failed');
    expect(tx.order.create).toHaveBeenCalled();
  });

  function adjustmentTx(status: string, options?: {
    itemQuantity?: number;
    otherItemCount?: number;
    otherOrders?: Array<{
      id: bigint;
      status: string;
      itemQuantity: number;
    }>;
    priorRequest?: unknown;
    openSession?: boolean;
    sessionCloseCount?: number;
  }) {
    const itemQuantity = options?.itemQuantity ?? 2;
    const otherOrders = options?.otherOrders ?? [];
    return {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 41n,
          tableId: 11n,
          tableSessionId: 51n,
          orderType: 'DINE_IN',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: {
        create: jest.fn().mockResolvedValue({ id: 91n }),
      },
      orderItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      tableSession: {
        updateMany: jest.fn().mockResolvedValue({
          count: options?.sessionCloseCount ?? 1,
        }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 11n }])
        .mockResolvedValueOnce(
          options?.openSession === false
            ? [{ id: 51n, table_id: 11n, status: 'CLOSED', open_table_id: null }]
            : [{ id: 51n, table_id: 11n, status: 'OPEN', open_table_id: 11n }],
        )
        .mockResolvedValueOnce([
          {
            id: 41n,
            status,
            order_type: 'DINE_IN',
            table_id: 11n,
            table_session_id: 51n,
            item_amount_vnd: 12000n,
            delivery_fee_vnd: 0n,
            total_amount_vnd: 12000n,
          },
          ...otherOrders.map((other) => ({
            id: other.id,
            status: other.status,
            order_type: 'DINE_IN',
            table_id: 11n,
            table_session_id: 51n,
            item_amount_vnd: BigInt(other.itemQuantity * 1000),
            delivery_fee_vnd: 0n,
            total_amount_vnd: BigInt(other.itemQuantity * 1000),
          })),
        ])
        .mockResolvedValueOnce(
          options?.priorRequest ? [options.priorRequest] : [],
        )
        .mockResolvedValueOnce([
          {
            id: 71n,
            order_id: 41n,
            product_id: 61n,
            product_name_zh_snapshot: '鱼香茄子',
            unit_price_vnd: 6000n,
            quantity: itemQuantity,
            subtotal_vnd: 12000n,
          },
          ...Array.from({ length: options?.otherItemCount ?? 0 }, (_, index) => ({
            id: BigInt(80 + index),
            order_id: 41n,
            product_id: BigInt(70 + index),
            product_name_zh_snapshot: `其他菜品${index}`,
            unit_price_vnd: 1000n,
            quantity: 1,
            subtotal_vnd: 1000n,
          })),
          ...otherOrders.map((other, index) => ({
            id: BigInt(180 + index),
            order_id: other.id,
            product_id: BigInt(170 + index),
            product_name_zh_snapshot: `其他订单菜品${index}`,
            unit_price_vnd: 1000n,
            quantity: other.itemQuantity,
            subtotal_vnd: BigInt(other.itemQuantity * 1000),
          })),
        ]),
    };
  }

  it('decreases a pending item and writes structured same-state audit metadata', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE');
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_0001',
        expectedQuantity: 2,
        targetQuantity: 1,
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: 71n },
      data: { quantity: 1, subtotalVnd: 6000n },
    });
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORDER_ITEM_DECREASED',
        requestKey: 'decrease_0001',
        fromStatus: 'PENDING_ACCEPTANCE',
        toStatus: 'PENDING_ACCEPTANCE',
        metadata: expect.objectContaining({
          beforeQuantity: 2,
          afterQuantity: 1,
          delta: -1,
          beforeOrderAmountVnd: '12000',
          afterOrderAmountVnd: '6000',
        }),
      }),
    });
  });

  it.each(['ACCEPTED', 'PREPARING', 'READY'])(
    'returns an item in allowed status %s',
    async (status) => {
      const tx = adjustmentTx(status);
      const { service } = buildService(tx);
      await expect(
        service.returnOrderItem(7n, 3n, 41n, 71n, {
          requestKey: `return_${status}`,
          expectedQuantity: 2,
          returnQuantity: 1,
        }),
      ).resolves.toEqual({ order: orderResult, session: sessionResult });
      expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ORDER_ITEM_RETURNED',
          metadata: expect.objectContaining({ returnedQuantity: 1 }),
        }),
      });
    },
  );

  it('uses the shared safe pending cancellation when the last item reaches zero', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE', { otherItemCount: 0 });
    const cancellation = { cancel: jest.fn().mockResolvedValue({ id: 92n }) };
    const { service } = buildService(tx, { cancellation });
    await service.decreaseOrderItem(7n, 3n, 41n, 71n, {
      requestKey: 'decrease_last_1',
      expectedQuantity: 2,
      targetQuantity: 0,
    });
    expect(cancellation.cancel).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId: 41n,
        merchantId: 7n,
        operatorStaffId: 3n,
        itemAmountVnd: 0n,
        totalAmountVnd: 0n,
      }),
    );
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it.each(['ACCEPTED', 'PREPARING', 'READY'])(
    'returns the final table item in %s, cancels the empty order, and keeps the table session open',
    async (status) => {
      const tx = adjustmentTx(status, { otherItemCount: 0 });
      const { service, cancellation, printJobs } = buildService(tx);

      await expect(
        service.returnOrderItem(7n, 3n, 41n, 71n, {
          requestKey: `return_last_${status}`,
          expectedQuantity: 2,
          returnQuantity: 2,
        }),
      ).resolves.toEqual({ order: orderResult, session: sessionResult });

      expect(tx.orderItem.delete).toHaveBeenCalledWith({ where: { id: 71n } });
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 41n,
          merchantId: 7n,
          status,
          tableSessionId: 51n,
        },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          itemAmountVnd: 0n,
          totalAmountVnd: 0n,
        }),
      });
      expect(tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'CLOSED', openTableId: null }),
      }));
      expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN',
          fromStatus: status,
          toStatus: 'CANCELLED',
          metadata: expect.objectContaining({
            tableSessionAutoClosed: false,
            tableReleased: false,
            effectiveQuantityAfterAdjustment: 0,
          }),
        }),
      });
      expect(cancellation.cancel).not.toHaveBeenCalled();
      expect(printJobs.enqueueAutomaticTriggersForOrderTransition).not.toHaveBeenCalled();
    },
  );

  it('removes a quantity-one item without cancelling or releasing while the same order has another item', async () => {
    const tx = adjustmentTx('ACCEPTED', { itemQuantity: 1, otherItemCount: 1 });
    const { service } = buildService(tx);

    await service.returnOrderItem(7n, 3n, 41n, 71n, {
      requestKey: 'return_quantity_one_with_other_item',
      expectedQuantity: 1,
      returnQuantity: 1,
    });

    expect(tx.orderItem.delete).toHaveBeenCalledWith({ where: { id: 71n } });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 41n,
        merchantId: 7n,
        status: 'ACCEPTED',
        tableSessionId: 51n,
      },
      data: { itemAmountVnd: 1000n, totalAmountVnd: 1000n },
    });
    expect(tx.order.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CLOSED', openTableId: null }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORDER_ITEM_RETURNED',
        metadata: expect.objectContaining({
          afterQuantity: 0,
          tableSessionAutoClosed: false,
          tableReleased: false,
        }),
      }),
    });
  });

  it('cancels only the emptied order while another effective order keeps the table open', async () => {
    const tx = adjustmentTx('ACCEPTED', {
      otherOrders: [{ id: 42n, status: 'PREPARING', itemQuantity: 1 }],
    });
    const { service } = buildService(tx);

    await service.returnOrderItem(7n, 3n, 41n, 71n, {
      requestKey: 'return_empty_one_order',
      expectedQuantity: 2,
      returnQuantity: 2,
    });

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ openTableId: 11n }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN',
        metadata: expect.objectContaining({
          tableSessionAutoClosed: false,
          tableReleased: false,
          effectiveQuantityAfterAdjustment: 1,
        }),
      }),
    });
  });

  it('keeps the table session open even when only cancelled history remains', async () => {
    const tx = adjustmentTx('READY', {
      otherOrders: [{ id: 42n, status: 'CANCELLED', itemQuantity: 4 }],
    });
    const { service } = buildService(tx);

    await service.returnOrderItem(7n, 3n, 41n, 71n, {
      requestKey: 'return_last_with_cancelled_history',
      expectedQuantity: 2,
      returnQuantity: 2,
    });

    expect(tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CLOSED', openTableId: null }),
    }));
  });

  it('does not depend on a session-close write when the final item is returned', async () => {
    const tx = adjustmentTx('ACCEPTED', { sessionCloseCount: 0 });
    const { service } = buildService(tx);

    await expect(
      service.returnOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'return_close_conflict',
        expectedQuantity: 2,
        returnQuantity: 2,
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });
    expect(tx.tableSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CLOSED', openTableId: null }),
    }));
  });

  it.each([
    ['decrease', 'ACCEPTED'],
    ['return', 'PENDING_ACCEPTANCE'],
    ['return', 'COMPLETED'],
    ['return', 'CANCELLED'],
    ['return', 'DELIVERING'],
  ])('rejects %s in order status %s', async (kind, status) => {
    const tx = adjustmentTx(status);
    const { service } = buildService(tx);
    const promise =
      kind === 'decrease'
        ? service.decreaseOrderItem(7n, 3n, 41n, 71n, {
            requestKey: `invalid_${status}`,
            expectedQuantity: 2,
            targetQuantity: 1,
          })
        : service.returnOrderItem(7n, 3n, 41n, 71n, {
            requestKey: `invalid_${status}`,
            expectedQuantity: 2,
            returnQuantity: 1,
          });
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORDER_STATUS_CHANGED' }),
    });
  });

  it('returns a quantity conflict without applying an adjustment', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE', { itemQuantity: 3 });
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_stale1',
        expectedQuantity: 2,
        targetQuantity: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ORDER_ITEM_QUANTITY_CHANGED',
      }),
    });
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('returns the prior result for an idempotent adjustment after locking the order', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE', {
      priorRequest: {
        action: 'ORDER_ITEM_DECREASED',
        metadata: {
          orderItemId: '71',
          actorId: '3',
          beforeQuantity: 2,
          afterQuantity: 1,
          decreasedQuantity: 1,
        },
      },
    });
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_retry1',
        expectedQuantity: 2,
        targetQuantity: 1,
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('returns an idempotent prior result even if the session closed afterward', async () => {
    const tx = adjustmentTx('COMPLETED', {
      openSession: false,
      priorRequest: {
        action: 'ORDER_ITEM_RETURNED',
        metadata: JSON.stringify({
          orderItemId: '71',
          actorId: '3',
          beforeQuantity: 2,
          afterQuantity: 1,
          returnedQuantity: 1,
        }),
      },
    });
    const { service } = buildService(tx);
    await expect(
      service.returnOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'return_prior_01',
        expectedQuantity: 2,
        returnQuantity: 1,
      }),
    ).resolves.toEqual({ order: orderResult, session: sessionResult });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('rejects request-key reuse with a different quantity payload', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE', {
      priorRequest: {
        action: 'ORDER_ITEM_DECREASED',
        metadata: {
          orderItemId: '71',
          actorId: '3',
          beforeQuantity: 2,
          afterQuantity: 1,
          decreasedQuantity: 1,
        },
      },
    });
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_reused',
        expectedQuantity: 2,
        targetQuantity: 0,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ADJUSTMENT_REQUEST_KEY_CONFLICT',
      }),
    });
  });

  it('rejects adjustment after the table session is closed', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE', { openSession: false });
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_closed',
        expectedQuantity: 2,
        targetQuantity: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TABLE_SESSION_CLOSED' }),
    });
  });

  it('rejects an inconsistent order-to-table-session association', async () => {
    const tx = adjustmentTx('PENDING_ACCEPTANCE');
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: 11n }])
      .mockResolvedValueOnce([
        { id: 51n, table_id: 11n, status: 'OPEN', open_table_id: 11n },
      ])
      .mockResolvedValueOnce([
        {
          id: 41n,
          status: 'PENDING_ACCEPTANCE',
          order_type: 'DINE_IN',
          table_id: 12n,
          table_session_id: 51n,
          item_amount_vnd: 12000n,
          delivery_fee_vnd: 0n,
          total_amount_vnd: 12000n,
        },
      ]);
    const { service } = buildService(tx);
    await expect(
      service.decreaseOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'decrease_bad_scope',
        expectedQuantity: 2,
        targetQuantity: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ORDER_TABLE_SESSION_MISMATCH',
      }),
    });
  });
});
