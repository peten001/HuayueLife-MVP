import { ConflictException } from '@nestjs/common';
import { PendingOrderCancellationService } from './pending-order-cancellation.service';

describe('PendingOrderCancellationService', () => {
  const service = new PendingOrderCancellationService();

  function transaction() {
    return {
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 9n }) },
    };
  }

  it('preserves customer cancellation ownership and actor semantics', async () => {
    const tx = transaction();
    await service.cancel(tx as never, {
      orderId: 10n,
      userId: 5n,
      operatorUserId: 5n,
      reason: '用户取消订单',
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 10n, userId: 5n }),
      }),
    );
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operatorType: 'USER',
        operatorUserId: 5n,
        operatorStaffId: undefined,
      }),
    });
  });

  it('supports the merchant last-item cancellation in the same transaction', async () => {
    const tx = transaction();
    await service.cancel(tx as never, {
      orderId: 11n,
      merchantId: 7n,
      operatorStaffId: 3n,
      reason: '商家将未接单订单全部减为零，订单已取消',
      itemAmountVnd: 0n,
      totalAmountVnd: 0n,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 11n, merchantId: 7n }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          itemAmountVnd: 0n,
          totalAmountVnd: 0n,
        }),
      }),
    );
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operatorType: 'MERCHANT_STAFF',
        operatorStaffId: 3n,
      }),
    });
  });

  it('preserves the customer HTTP_409 contract on a cancellation race', async () => {
    const tx = transaction();
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.cancel(tx as never, {
        orderId: 12n,
        userId: 5n,
        operatorUserId: 5n,
        reason: '用户取消订单',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      message: '订单状态已变化，请刷新后重试',
      error: 'Conflict',
    });
  });

  it('keeps the structured conflict for merchant item adjustments', async () => {
    const tx = transaction();
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.cancel(tx as never, {
        orderId: 13n,
        merchantId: 7n,
        operatorStaffId: 3n,
        reason: '商家将未接单订单全部减为零，订单已取消',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORDER_STATUS_CHANGED' }),
    });
  });
});
