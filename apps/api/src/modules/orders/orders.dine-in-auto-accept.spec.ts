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
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(storedOrder),
      },
      cart: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const tableSessions = {
      getOrCreateOpenSession: jest.fn().mockResolvedValue({ id: 11n, created: true }),
    };
    const printJobs = {
      enqueueAutomaticTriggersForOrderTransition: jest.fn().mockResolvedValue([{ id: 801n }]),
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
        items: [
          {
            product: { id: 41n, nameZh: 'Test item', priceVnd: 1000n },
            quantity: 1,
            subtotalVnd: 1000n,
          },
        ],
        itemAmountVnd: 1000n,
        deliveryFeeVnd: 0n,
        totalAmountVnd: 1000n,
      }),
    });
    return { service, tx, printJobs };
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
              operatorUserId: undefined,
              action: 'DINE_IN_AUTO_ACCEPTED',
            }),
          },
        }),
      }),
    );
    expect(printJobs.enqueueAutomaticTriggersForOrderTransition).toHaveBeenCalledTimes(1);
    expect(printJobs.processAutomaticTriggerIds).toHaveBeenCalledWith([801n]);
  });

  it.each(['PICKUP', 'DELIVERY'] as const)(
    'keeps %s customer orders pending acceptance',
    async (orderType) => {
      const { service, tx, printJobs } = buildService(orderType);

      await service.create(5n, `pickup_${orderType.toLowerCase()}`, { orderType } as never);

      expect(tx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_ACCEPTANCE', acceptedAt: undefined }),
        }),
      );
      expect(printJobs.enqueueAutomaticTriggersForOrderTransition).not.toHaveBeenCalled();
    },
  );
});
