import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService table ordering and item adjustments', () => {
  const orderResult = { id: 41n, status: 'PENDING_ACCEPTANCE' };
  const sessionResult = { id: 51n, totalAmountVnd: 12000n };

  function buildService(tx: Record<string, unknown>, overrides?: {
    outsideOrder?: unknown;
    creator?: Record<string, unknown>;
    cancellation?: Record<string, unknown>;
  }) {
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
    };
    const creator = overrides?.creator ?? {
      assertValid: jest.fn().mockResolvedValue({ staffRole: 'STAFF' }),
    };
    const cancellation = overrides?.cancellation ?? {
      cancel: jest.fn().mockResolvedValue({ id: 99n }),
    };
    const service = new MerchantOrdersService(
      prisma as never,
      {} as never,
      tableSessions as never,
      creator as never,
      cancellation as never,
    );
    return { service, prisma, tableSessions, creator, cancellation };
  }

  it('creates a separate staff order with server-side product pricing', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 41n, tableSessionId: 51n }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([{ id: 51n, table_id: 11n }])
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
              }),
            ]),
          },
        }),
      }),
    );
  });

  it('returns the existing add-on order for the same staff idempotency key', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 41n,
          tableId: 11n,
          tableSessionId: 51n,
          statusLogs: [
            {
              metadata: {
                items: [
                  { productId: '61', quantity: 2, remark: null },
                ],
              },
            },
          ],
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
        findUnique: jest.fn().mockResolvedValue({
          id: 41n,
          tableId: 11n,
          tableSessionId: 51n,
          statusLogs: [
            {
              metadata: {
                items: [{ productId: '61', quantity: 2, remark: null }],
              },
            },
          ],
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

  it('rejects staff ordering when the table has no OPEN session', async () => {
    const tx = {
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 11n, table_no: 'A01', table_name: null, status: 'ACTIVE' },
        ])
        .mockResolvedValueOnce([]),
    };
    const { service } = buildService(tx);
    await expect(
      service.createTableOrder(7n, 3n, 11n, {
        idempotencyKey: 'staff_add_0002',
        items: [{ productId: '61', quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TABLE_SESSION_NOT_OPEN' }),
    });
  });

  function adjustmentTx(status: string, options?: {
    itemQuantity?: number;
    otherItemCount?: number;
    priorRequest?: unknown;
    openSession?: boolean;
  }) {
    const itemQuantity = options?.itemQuantity ?? 2;
    return {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 41n,
          tableSessionId: 51n,
          orderType: 'DINE_IN',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: {
        create: jest.fn().mockResolvedValue({ id: 91n }),
      },
      orderItem: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest
        .fn()
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
        ])
        .mockResolvedValueOnce(
          options?.priorRequest ? [options.priorRequest] : [],
        )
        .mockResolvedValueOnce([
          {
            id: 71n,
            product_id: 61n,
            product_name_zh_snapshot: '鱼香茄子',
            unit_price_vnd: 6000n,
            quantity: itemQuantity,
            subtotal_vnd: 12000n,
          },
          ...Array.from({ length: options?.otherItemCount ?? 0 }, (_, index) => ({
            id: BigInt(80 + index),
            product_id: BigInt(70 + index),
            product_name_zh_snapshot: `其他菜品${index}`,
            unit_price_vnd: 1000n,
            quantity: 1,
            subtotal_vnd: 1000n,
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

  it('forbids returning the last effective item in an accepted order', async () => {
    const tx = adjustmentTx('ACCEPTED', { otherItemCount: 0 });
    const { service } = buildService(tx);
    await expect(
      service.returnOrderItem(7n, 3n, 41n, 71n, {
        requestKey: 'return_last_01',
        expectedQuantity: 2,
        returnQuantity: 2,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LAST_ORDER_ITEM_RETURN_NOT_ALLOWED',
      }),
    });
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
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
