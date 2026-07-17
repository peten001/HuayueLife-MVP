import { OrdersService } from './orders.service';

describe('OrdersService printing outbox', () => {
  it('enqueues customer-confirmed COMPLETED intent in the same transaction', async () => {
    let insideTransaction = false;
    const completed = {
      id: 37n,
      userId: 5n,
      merchantId: 7n,
      orderType: 'DELIVERY',
      status: 'COMPLETED',
    };
    const storedCompleted = { ...completed, createdByStaffId: null };
    const tx = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 37n,
          merchantId: 7n,
          orderType: 'DELIVERY',
          status: 'DELIVERING',
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue(storedCompleted),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 9003n }) },
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
          return [{ id: 503n }];
        },
      ),
      processAutomaticTriggerIds: jest.fn().mockResolvedValue([
        { id: 503n, outcome: 'PROCESSED' },
      ]),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      printJobs as never,
    );

    await expect(service.confirmReceived(5n, 37n)).resolves.toEqual(completed);

    expect(printJobs.enqueueAutomaticTriggersForOrderTransition).toHaveBeenCalledWith(
      tx,
      {
        merchantId: 7n,
        orderId: 37n,
        orderStatusLogId: 9003n,
        orderType: 'DELIVERY',
        status: 'COMPLETED',
      },
    );
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([503n]);
    expect(insideTransaction).toBe(false);
  });
});
