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

describe('PrintingRoutingService current configuration', () => {
  const merchantId = 7n;
  const oldPrinterId = 41n;
  const newPrinterId = 42n;

  it('queries rules and category bindings through current merchant printers only', async () => {
    const { service, prisma } = createRoutingService();

    await service.get(merchantId);

    expect(prisma.printer.findMany).toHaveBeenCalledWith({
      where: { merchantId, deletedAt: null },
      select: { id: true },
    });
    expect(prisma.printRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          printer: { merchantId, deletedAt: null },
        }),
      }),
    );
    expect(prisma.printerCategoryBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          merchantId,
          printer: { merchantId, deletedAt: null },
        },
      }),
    );
  });

  it.each([
    'archived printer',
    'missing printer',
    'other merchant printer',
  ])('does not return a managed rule for an %s', async () => {
    const { service, prisma } = createRoutingService();
    prisma.printRule.findMany.mockResolvedValue([
      managedRule(oldPrinterId, 'FRONT_DESK', true),
    ]);
    prisma.printer.findMany.mockResolvedValue([]);

    await expect(service.get(merchantId)).resolves.toEqual(
      expect.objectContaining({ frontDeskPrinters: [], kitchenPrinters: [] }),
    );
  });

  it('returns an editable disabled rule when its printer is current', async () => {
    const { service, prisma } = createRoutingService();
    prisma.printRule.findMany.mockResolvedValue([
      managedRule(newPrinterId, 'FRONT_DESK', false),
    ]);
    prisma.printer.findMany.mockResolvedValue([{ id: newPrinterId }]);

    await expect(service.get(merchantId)).resolves.toEqual(
      expect.objectContaining({
        frontDeskPrinters: [
          {
            printerId: newPrinterId.toString(),
            newOrderAutoPrint: false,
            categoryIds: [],
          },
        ],
      }),
    );
  });

  it('filters stale bindings and clears defaults that are not current', async () => {
    const { service, prisma } = createRoutingService();
    prisma.merchantPrintingRouting.findUnique.mockResolvedValue({
      merchantId,
      checkoutDefaultPrinterId: oldPrinterId,
      defaultKitchenPrinterId: oldPrinterId,
    });
    prisma.printerCategoryBinding.findMany.mockResolvedValue([
      { printerId: oldPrinterId, categoryId: 101n },
      { printerId: newPrinterId, categoryId: 102n },
    ]);
    prisma.printRule.findMany.mockResolvedValue([
      managedRule(newPrinterId, 'KITCHEN', true),
    ]);
    prisma.printer.findMany.mockResolvedValue([{ id: newPrinterId }]);

    await expect(service.get(merchantId)).resolves.toEqual({
      configured: true,
      checkoutDefaultPrinterId: null,
      defaultKitchenPrinterId: null,
      frontDeskPrinters: [],
      kitchenPrinters: [
        {
          printerId: newPrinterId.toString(),
          newOrderAutoPrint: true,
          categoryIds: ['102'],
        },
      ],
    });
  });

  it('returns only the re-added current printer beside a retained archived rule', async () => {
    const { service, prisma } = createRoutingService();
    prisma.printRule.findMany.mockResolvedValue([
      managedRule(oldPrinterId, 'FRONT_DESK', false),
      managedRule(newPrinterId, 'FRONT_DESK', false),
    ]);
    prisma.printer.findMany.mockResolvedValue([{ id: newPrinterId }]);

    const result = await service.get(merchantId);

    expect(result.frontDeskPrinters.map((entry) => entry.printerId)).toEqual([
      newPrinterId.toString(),
    ]);
  });

  it('saves a newly selected current printer', async () => {
    const { service, prisma, audit } = createRoutingService();
    prisma.printer.findMany
      .mockResolvedValueOnce([{ id: newPrinterId, enabled: true }])
      .mockResolvedValueOnce([{ id: newPrinterId }]);
    prisma.merchantPrintingRouting.findUnique.mockResolvedValue({
      merchantId,
      checkoutDefaultPrinterId: newPrinterId,
      defaultKitchenPrinterId: null,
    });
    prisma.printRule.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        managedRule(newPrinterId, 'FRONT_DESK', true),
      ]);

    await expect(
      service.update(merchantId, 3n, 'request-new-printer', {
        checkoutDefaultPrinterId: newPrinterId.toString(),
        defaultKitchenPrinterId: null,
        frontDeskPrinters: [
          {
            printerId: newPrinterId.toString(),
            newOrderAutoPrint: true,
            categoryIds: [],
          },
        ],
        kitchenPrinters: [],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        checkoutDefaultPrinterId: newPrinterId.toString(),
        frontDeskPrinters: [
          expect.objectContaining({ printerId: newPrinterId.toString() }),
        ],
      }),
    );
    expect(prisma.printRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ printerId: newPrinterId }),
      }),
    );
    expect(audit.record).toHaveBeenCalled();
  });

  it('continues to reject a directly submitted archived printer id', async () => {
    const { service, prisma } = createRoutingService();
    prisma.printer.findMany.mockResolvedValue([]);

    await expect(
      service.update(merchantId, 3n, undefined, {
        checkoutDefaultPrinterId: oldPrinterId.toString(),
        frontDeskPrinters: [
          {
            printerId: oldPrinterId.toString(),
            newOrderAutoPrint: false,
            categoryIds: [],
          },
        ],
        kitchenPrinters: [],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CONFIG_INVALID',
        message: '打印机不存在、已删除或不属于当前商家',
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  function createRoutingService() {
    const prisma = {
      merchantPrintingRouting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      printerCategoryBinding: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      printRule: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn(),
      },
      printer: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const service = new PrintingRoutingService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      { assertMerchantPrintingEnabled: jest.fn() } as never,
      audit as never,
    );
    return { service, prisma, audit };
  }

  function managedRule(
    printerId: bigint,
    scene: 'FRONT_DESK' | 'KITCHEN',
    active: boolean,
  ) {
    return {
      name: `__ROUTING_NEW_ORDER__:${scene}:${printerId}`,
      printerId,
      autoPrint: active,
      enabled: active,
      printer: { purpose: scene },
    };
  }
});
