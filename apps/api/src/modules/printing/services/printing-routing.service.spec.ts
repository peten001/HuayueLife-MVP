import { PrintingRoutingService } from './printing-routing.service';

describe('PrintingRoutingService kitchen routing', () => {
  const merchantId = 7n;
  const defaultKitchenPrinterId = 31n;
  const grillPrinterId = 21n;
  const hotDishPrinterId = 22n;
  const bindings = [
    { merchantId, printerId: grillPrinterId, categoryId: 101n },
    { merchantId, printerId: hotDishPrinterId, categoryId: 102n },
  ];

  function createService(printerId: bigint) {
    const prisma = {
      merchantPrintingRouting: {
        findUnique: jest.fn().mockResolvedValue({ merchantId, defaultKitchenPrinterId }),
      },
      printer: {
        findFirst: jest.fn().mockResolvedValue({
          id: printerId,
          purpose: 'KITCHEN',
          enabled: true,
        }),
      },
      printerCategoryBinding: { findMany: jest.fn().mockResolvedValue(bindings) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          items: [
            { product: { categoryId: 101n } },
            { product: { categoryId: 102n } },
            { product: { categoryId: 103n } },
          ],
        }),
      },
    };
    return new PrintingRoutingService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      { assertMerchantPrintingEnabled: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
  }

  it('splits categories by kitchen printer and sends unmatched items to the default once', async () => {
    await expect(
      createService(grillPrinterId).kitchenRoutingForOrder(merchantId, grillPrinterId, 900n),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [101n] });
    await expect(
      createService(hotDishPrinterId).kitchenRoutingForOrder(merchantId, hotDishPrinterId, 900n),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [102n] });
    await expect(
      createService(defaultKitchenPrinterId).kitchenRoutingForOrder(merchantId, defaultKitchenPrinterId, 900n),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [103n] });
  });
});
