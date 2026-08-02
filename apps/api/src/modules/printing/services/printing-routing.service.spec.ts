import { PrintingRoutingService } from './printing-routing.service';

describe('PrintingRoutingService kitchen routing', () => {
  const merchantId = 7n;
  const defaultKitchenPrinterId = 31n;
  const frontDeskRuleId = 11n;
  const grillKitchenRuleId = 12n;
  const hotDishKitchenRuleId = 13n;
  const defaultKitchenRuleId = 14n;
  const grillPrinterId = 21n;
  const hotDishPrinterId = 22n;
  const bindings = [
    { merchantId, printerId: grillPrinterId, categoryId: 101n },
    { merchantId, printerId: hotDishPrinterId, categoryId: 102n },
  ];

  function createService(printerId: bigint, kitchenRuleId: bigint, isKitchen = true) {
    const prisma = {
      merchantPrintingRouting: {
        findUnique: jest.fn().mockResolvedValue({ merchantId, defaultKitchenPrinterId }),
      },
      printer: {
        findFirst: jest.fn(),
      },
      printRule: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          isKitchen && where.id === kitchenRuleId && where.name === `__ROUTING_NEW_ORDER__:KITCHEN:${printerId}`
            ? { id: kitchenRuleId }
            : null,
        ),
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

  it('splits categories by kitchen scene and allows the same physical printer in both scenes', async () => {
    await expect(
      createService(grillPrinterId, grillKitchenRuleId).kitchenRoutingForOrder(
        merchantId,
        grillPrinterId,
        900n,
        grillKitchenRuleId,
      ),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [101n] });
    await expect(
      createService(grillPrinterId, frontDeskRuleId, false).kitchenRoutingForOrder(
        merchantId,
        grillPrinterId,
        900n,
        frontDeskRuleId,
      ),
    ).resolves.toEqual({ isKitchen: false, categoryIds: [] });
    await expect(
      createService(hotDishPrinterId, hotDishKitchenRuleId).kitchenRoutingForOrder(
        merchantId,
        hotDishPrinterId,
        900n,
        hotDishKitchenRuleId,
      ),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [102n] });
    await expect(
      createService(defaultKitchenPrinterId, defaultKitchenRuleId).kitchenRoutingForOrder(
        merchantId,
        defaultKitchenPrinterId,
        900n,
        defaultKitchenRuleId,
      ),
    ).resolves.toEqual({ isKitchen: true, categoryIds: [103n] });
  });
});
