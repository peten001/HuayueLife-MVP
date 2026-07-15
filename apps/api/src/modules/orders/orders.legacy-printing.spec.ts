import { OrdersService } from './orders.service';

describe('OrdersService legacy printing gate', () => {
  it.each([
    [false, 0],
    [true, 1],
  ])(
    'creates the order normally with legacy enabled=%s and invokes it %s time(s)',
    async (legacyEnabled, expectedCalls) => {
      const createdOrder = { id: 91n, merchantId: 7n };
      const tx = {
        order: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(createdOrder),
        },
        cart: { update: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        order: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(
          async (work: (client: typeof tx) => unknown) => work(tx),
        ),
      };
      const printers = {
        printOrder: jest.fn().mockResolvedValue({ skipped: true }),
      };
      const appConfig = { assertOrderingEnabled: jest.fn() };
      const printingFlags = {
        legacyPrintingEnabled: jest.fn(() => legacyEnabled),
      };
      const service = new OrdersService(
        prisma as never,
        {} as never,
        printers as never,
        {} as never,
        appConfig as never,
        printingFlags as never,
      );
      Object.defineProperty(service, 'validateAndPrice', {
        value: jest.fn().mockResolvedValue({
          cartId: 31n,
          merchant: { id: 7n, nameZh: 'Test merchant' },
          table: null,
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

      await expect(
        service.create(5n, 'cutover_12345678', {
          orderType: 'PICKUP',
          contactName: 'Test',
          contactPhone: '00000000',
        } as never),
      ).resolves.toBe(createdOrder);

      expect(tx.order.create).toHaveBeenCalledTimes(1);
      expect(tx.cart.update).toHaveBeenCalledTimes(1);
      expect(printers.printOrder).toHaveBeenCalledTimes(expectedCalls);
      if (legacyEnabled) {
        expect(printers.printOrder).toHaveBeenCalledWith(7n, 91n, 'SYSTEM');
      }
    },
  );

  it('does not let a legacy print failure affect a completed order creation', async () => {
    const createdOrder = { id: 92n, merchantId: 7n };
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdOrder),
      },
      cart: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        async (work: (client: typeof tx) => unknown) => work(tx),
      ),
    };
    const printers = {
      printOrder: jest.fn().mockRejectedValue(new Error('test printer failure')),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      printers as never,
      {} as never,
      { assertOrderingEnabled: jest.fn() } as never,
      { legacyPrintingEnabled: jest.fn(() => true) } as never,
    );
    Object.defineProperty(service, 'validateAndPrice', {
      value: jest.fn().mockResolvedValue({
        cartId: 31n,
        merchant: { id: 7n, nameZh: 'Test merchant' },
        table: null,
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

    await expect(
      service.create(5n, 'cutover_87654321', {
        orderType: 'PICKUP',
        contactName: 'Test',
        contactPhone: '00000000',
      } as never),
    ).resolves.toBe(createdOrder);
    expect(printers.printOrder).toHaveBeenCalledTimes(1);
  });
});
