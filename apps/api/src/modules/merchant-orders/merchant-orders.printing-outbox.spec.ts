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
    );

    await expect(service.transition(7n, 3n, 37n, 'ACCEPT')).resolves.toBe(
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
    const accepted = {
      id: 38n,
      merchantId: 7n,
      orderType: 'PICKUP',
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
    );

    await expect(service.transition(7n, 3n, 38n, 'ACCEPT')).resolves.toBe(
      accepted,
    );
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([502n]);
  });
});
