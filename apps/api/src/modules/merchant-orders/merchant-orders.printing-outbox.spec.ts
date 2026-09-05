import { effectiveOrderWhere } from '../orders/effective-order';
import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService printing outbox', () => {
  it('enqueues ACCEPTED intent in the exact order transition transaction', async () => {
    let insideTransaction = false;
    const accepted = {
      id: 37n,
      merchantId: 7n,
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
    };
    const tx = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 37n,
            orderType: 'DINE_IN',
            status: 'PENDING_ACCEPTANCE',
          }),
        findFirstOrThrow: jest.fn().mockResolvedValue(accepted),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: {
        create: jest.fn().mockResolvedValue({ id: 9001n }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => {
        insideTransaction = true;
        try {
          return await work(tx);
        } finally {
          insideTransaction = false;
        }
      }),
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest.fn(
        async (client: typeof tx) => {
          expect(client).toBe(tx);
          expect(insideTransaction).toBe(true);
          return [{ id: 501n }];
        },
      ),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([
        { id: 501n, outcome: 'PROCESSED' },
      ]),
    };
    const service = new MerchantOrdersService(
      prisma as never,
      printJobs as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.transition(7n, 3n, 37n, 'ACCEPT')).resolves.toEqual(
      accepted,
    );

    expect(tx.orderStatusLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'ACCEPTED' }),
      }),
    );
    expect(printJobs.enqueueAutomaticTriggersForOrderTransition).toHaveBeenCalledWith(
      tx,
      {
        merchantId: 7n,
        orderId: 37n,
        orderStatusLogId: 9001n,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      },
    );
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([501n]);
    expect(insideTransaction).toBe(false);
  });

  it('returns the accepted order when immediate processing fails because intent is durable', async () => {
    const createdAt = new Date('2026-07-24T08:00:00.000Z');
    const accepted = {
      id: 38n,
      merchantId: 7n,
      orderType: 'PICKUP',
      orderNo: 'HY20260724A038',
      createdAt,
      readyAt: null,
      status: 'ACCEPTED',
    };
    const tx = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 38n,
            orderType: 'PICKUP',
            status: 'PENDING_ACCEPTANCE',
          }),
        findFirstOrThrow: jest.fn().mockResolvedValue(accepted),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 9002n }) },
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest
        .fn()
        .mockResolvedValue([{ id: 502n }]),
      processAutomaticTriggerIds: jest
        .fn()
        .mockRejectedValue(new Error('simulated post-commit interruption')),
    };
    const service = new MerchantOrdersService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as never,
      printJobs as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.transition(7n, 3n, 38n, 'ACCEPT')).resolves.toEqual({
      ...accepted,
      pickupCode: 'A038',
      estimatedReadyAt: new Date('2026-07-24T08:30:00.000Z'),
    });
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([502n]);
  });

  it.each(['CASH', 'BANK_TRANSFER'] as const)(
    'stores %s and business date in the same non-table completion transaction',
    async (paymentMethod) => {
    const completed = {
      id: 39n,
      merchantId: 7n,
      orderType: 'PICKUP',
      orderNo: 'HY20260815A039',
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
      readyAt: new Date('2026-08-15T11:00:00.000Z'),
      status: 'COMPLETED',
      totalAmountVnd: 80_000n,
    };
    const tx = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 39n,
          orderType: 'PICKUP',
          status: 'READY',
          merchant: { businessHours: { saturday: ['15:00-03:00'] } },
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue(completed),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 9003n }) },
    };
    const service = new MerchantOrdersService(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      {
        enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([]),
        processAutomaticTriggerIds: jest.fn(),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.transition(7n, 3n, 39n, 'COMPLETE', undefined, paymentMethod);

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: effectiveOrderWhere({ id: 39n, merchantId: 7n, status: 'READY' }),
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
        businessDate: expect.any(Date),
        paymentMethod,
      }),
    }));
    },
  );
});
