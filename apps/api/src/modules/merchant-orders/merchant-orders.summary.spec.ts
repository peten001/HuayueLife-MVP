import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService.summary', () => {
  it('returns full server-side counts and excludes cancelled order amounts', async () => {
    const createdAt = new Date('2026-08-02T05:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      { status: 'COMPLETED', orderType: 'DINE_IN', totalAmountVnd: 120000n, createdAt, printLogs: [] },
      { status: 'CANCELLED', orderType: 'PICKUP', totalAmountVnd: 90000n, createdAt, printLogs: [] },
      { status: 'PENDING_ACCEPTANCE', orderType: 'DELIVERY', totalAmountVnd: 50000n, createdAt, printLogs: [] },
      { status: 'COMPLETED', orderType: 'DELIVERY', totalAmountVnd: 70000n, createdAt, printLogs: [{ status: 'FAILED' }] },
    ]);
    const service = new MerchantOrdersService(
      {
        merchant: { findUnique: jest.fn().mockResolvedValue({ businessHours: { sunday: ['10:00-22:00'] } }) },
        order: { findMany },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.summary(7n, { date: '2026-08-02' })).resolves.toEqual({
      ALL: { count: 4, amountVnd: '240000' },
      DINE_IN: { count: 1, amountVnd: '120000' },
      PICKUP: { count: 1, amountVnd: '0' },
      DELIVERY: { count: 2, amountVnd: '120000' },
      ABNORMAL: { count: 2, amountVnd: '120000' },
      COMPLETED: {
        count: 2,
        amountVnd: '190000',
        grossAmountVnd: '190000',
        discountAmountVnd: '0',
        roundingAmountVnd: '0',
        cashRevenueVnd: '0',
        bankTransferRevenueVnd: '0',
        unrecordedRevenueVnd: '190000',
      },
      statusBreakdown: {
        CANCELLED: 1,
        COMPLETED: 2,
        PENDING_ACCEPTANCE: 1,
      },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ merchantId: 7n }),
    }));
  });

  it('builds an exact business-day settlement equation and includes every sold item', async () => {
    const order = (
      id: bigint,
      paymentMethod: 'CASH' | 'BANK_TRANSFER' | null,
      totalAmountVnd: bigint,
      name: string,
      quantity: number,
      adjustment: Partial<Record<'discountPayableRateBps' | 'discountAmountVnd' | 'roundingAmountVnd', number | bigint>> = {},
    ) => ({
      id,
      tableSessionId: null,
      businessDate: new Date('2026-08-15T00:00:00.000Z'),
      completedAt: new Date('2026-08-15T12:00:00.000Z'),
      paymentMethod,
      totalAmountVnd,
      itemAmountVnd: totalAmountVnd,
      deliveryFeeVnd: 0n,
      discountPayableRateBps: adjustment.discountPayableRateBps ?? null,
      discountAmountVnd: adjustment.discountAmountVnd ?? null,
      roundingAmountVnd: adjustment.roundingAmountVnd ?? null,
      tableSession: null,
      items: [{
        productNameZhSnapshot: name,
        quantity,
        product: { nameVi: null, nameEn: null },
      }],
    });
    const findMany = jest.fn().mockResolvedValue([
      order(1n, 'CASH', 100_000n, '红烧肉', 2, {
        discountPayableRateBps: 9000,
        discountAmountVnd: 10_000n,
        roundingAmountVnd: 1_000n,
      }),
      order(2n, 'BANK_TRANSFER', 50_000n, '米饭', 4),
      order(3n, null, 30_000n, '可乐', 3),
    ]);
    const service = new MerchantOrdersService(
      {
        merchant: { findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          nameZh: '测试店',
          nameVi: null,
          businessHours: { saturday: ['11:00-14:00', '16:00-01:00'] },
        }) },
        order: { findMany },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.businessDaySummary(7n, '2026-08-15');

    expect(result).toEqual(expect.objectContaining({
      businessDate: '2026-08-15',
      orderCount: 3,
      discountAmountVnd: '10000',
      roundingAmountVnd: '1000',
      totalRevenueVnd: '169000',
      cashRevenueVnd: '89000',
      bankTransferRevenueVnd: '50000',
      unrecordedRevenueVnd: '30000',
    }));
    expect(result.itemSummary.map((item) => item.nameZh)).toEqual([
      '米饭', '可乐', '红烧肉',
    ]);
    expect(
      BigInt(result.cashRevenueVnd) +
      BigInt(result.bankTransferRevenueVnd) +
      BigInt(result.unrecordedRevenueVnd),
    ).toBe(BigInt(result.totalRevenueVnd));
  });

  it('returns bilingual item names with safe fallbacks for deleted products', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n,
        tableSessionId: null,
        businessDate: new Date('2026-08-15T00:00:00.000Z'),
        completedAt: new Date('2026-08-15T12:00:00.000Z'),
        paymentMethod: 'CASH',
        totalAmountVnd: 100_000n,
        itemAmountVnd: 100_000n,
        deliveryFeeVnd: 0n,
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        tableSession: null,
        items: [
          {
            productNameZhSnapshot: '招牌牛肉锅',
            quantity: 2,
            product: { nameVi: 'Nồi bò đặc sản', nameEn: 'Signature beef pot' },
          },
          {
            productNameZhSnapshot: '历史删除菜品',
            quantity: 1,
            product: null,
          },
        ],
      },
    ]);
    const service = new MerchantOrdersService(
      {
        merchant: { findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          nameZh: '测试店',
          nameVi: null,
          businessHours: { saturday: ['11:00-14:00', '16:00-01:00'] },
        }) },
        order: { findMany },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.businessDaySummary(7n, '2026-08-15');
    expect(result.itemSummary).toEqual([
      { nameZh: '招牌牛肉锅', nameVi: 'Nồi bò đặc sản', nameEn: 'Signature beef pot', quantity: 2 },
      { nameZh: '历史删除菜品', nameVi: null, nameEn: null, quantity: 1 },
    ]);
  });

  it('prints only the top ten best-selling dishes with bilingual names and dashed dividers', async () => {
    const items = Array.from({ length: 12 }, (_, index) => {
      const quantity = index + 1;
      return {
        productNameZhSnapshot: `菜${quantity}`,
        quantity,
        product: { nameVi: `Món ${quantity}`, nameEn: null },
      };
    });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n,
        tableSessionId: null,
        businessDate: new Date('2026-08-15T00:00:00.000Z'),
        completedAt: new Date('2026-08-15T12:00:00.000Z'),
        paymentMethod: 'CASH',
        totalAmountVnd: 100_000n,
        itemAmountVnd: 100_000n,
        deliveryFeeVnd: 0n,
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        tableSession: null,
        items,
      },
    ]);
    const createBusinessSummaryPrintJob = jest.fn().mockResolvedValue({ id: 55n });
    const service = new MerchantOrdersService(
      {
        merchant: { findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          nameZh: '测试店',
          nameVi: null,
          businessHours: { saturday: ['15:00-01:00'] },
        }) },
        order: { findMany },
      } as never,
      { createBusinessSummaryPrintJob } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.printBusinessDaySummary(7n, 3n, '2026-08-15', 'print-key-001');
    const blocks = createBusinessSummaryPrintJob.mock.calls[0]![0].blocks as Array<{
      type: string;
      left?: string;
      right?: string;
      text?: string;
    }>;
    const serialized = blocks.map((block) => [
      block.type,
      block.text ?? '',
      block.left ?? '',
      block.right ?? '',
    ].join('|')).join('\n');

    expect(serialized).toContain('菜品销售 TOP10 / TOP10 món bán');
    const itemRows = blocks.filter(
      (block) => block.type === 'ROW' && (block.left ?? '').startsWith('Món '),
    );
    expect(itemRows).toHaveLength(10);
    expect(itemRows[0]!.left).toBe('Món 12 菜12');
    expect(itemRows[0]!.right).toBe('x 12');
    expect(itemRows[9]!.left).toBe('Món 3 菜3');
    expect(itemRows.some((row) => row.left === 'Món 2 菜2')).toBe(false);
    expect(itemRows.some((row) => row.left === 'Món 1 菜1')).toBe(false);
    expect(serialized).not.toContain('菜2');
    const dashes = blocks.filter(
      (block) => block.type === 'TEXT' && (block.text ?? '').startsWith('---'),
    );
    expect(dashes).toHaveLength(9);
    expect(serialized).toContain('已完成订单');
    expect(serialized).toContain('折扣');
    expect(serialized).toContain('抹零');
    expect(serialized).toContain('总收入');
    expect(serialized).toContain('现金');
    expect(serialized).toContain('银行转账');
    expect(serialized).not.toContain('历史未记录');
  });

  it('prints actual item count when fewer than ten dishes exist and omits an empty top-ten section', async () => {
    const withThree = jest.fn().mockResolvedValue([{
      id: 1n,
      tableSessionId: null,
      businessDate: new Date('2026-08-15T00:00:00.000Z'),
      completedAt: new Date('2026-08-15T12:00:00.000Z'),
      paymentMethod: 'CASH',
      totalAmountVnd: 100_000n,
      itemAmountVnd: 100_000n,
      deliveryFeeVnd: 0n,
      discountPayableRateBps: null,
      discountAmountVnd: null,
      roundingAmountVnd: null,
      tableSession: null,
      items: [
        { productNameZhSnapshot: '菜A', quantity: 2, product: { nameVi: 'Món A', nameEn: null } },
        { productNameZhSnapshot: '菜B', quantity: 5, product: { nameVi: 'Món B', nameEn: null } },
        { productNameZhSnapshot: '菜C', quantity: 1, product: { nameVi: null, nameEn: null } },
      ],
    }]);
    const withNone = jest.fn().mockResolvedValue([{
      id: 1n,
      tableSessionId: null,
      businessDate: new Date('2026-08-15T00:00:00.000Z'),
      completedAt: new Date('2026-08-15T12:00:00.000Z'),
      paymentMethod: 'CASH',
      totalAmountVnd: 100_000n,
      itemAmountVnd: 100_000n,
      deliveryFeeVnd: 0n,
      discountPayableRateBps: null,
      discountAmountVnd: null,
      roundingAmountVnd: null,
      tableSession: null,
      items: [],
    }]);
    const createBusinessSummaryPrintJob = jest.fn().mockResolvedValue({ id: 57n });
    const merchantFindUnique = jest.fn().mockResolvedValue({
      id: 7n,
      nameZh: '测试店',
      nameVi: null,
      businessHours: { saturday: ['15:00-01:00'] },
    });

    const serviceThree = new MerchantOrdersService(
      { merchant: { findUnique: merchantFindUnique }, order: { findMany: withThree } } as never,
      { createBusinessSummaryPrintJob } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await serviceThree.printBusinessDaySummary(7n, 3n, '2026-08-15', 'print-key-003');
    const blocksThree = createBusinessSummaryPrintJob.mock.calls[0]![0].blocks as Array<{
      type: string;
      left?: string;
      right?: string;
      text?: string;
    }>;
    const rowsThree = blocksThree.filter(
      (block) => block.type === 'ROW' && (block.left ?? '').startsWith('Món '),
    );
    expect(rowsThree).toHaveLength(2);
    expect(rowsThree[0]!.left).toBe('Món B 菜B');
    expect(rowsThree[0]!.right).toBe('x 5');
    expect(rowsThree[1]!.left).toBe('Món A 菜A');
    expect(rowsThree[1]!.right).toBe('x 2');
    expect(blocksThree.some(
      (block) => block.type === 'ROW' && block.left === '菜C',
    )).toBe(true);

    const serviceNone = new MerchantOrdersService(
      { merchant: { findUnique: merchantFindUnique }, order: { findMany: withNone } } as never,
      { createBusinessSummaryPrintJob } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await serviceNone.printBusinessDaySummary(7n, 3n, '2026-08-15', 'print-key-004');
    const blocksNone = createBusinessSummaryPrintJob.mock.calls[1]![0].blocks as Array<{
      text?: string;
    }>;
    expect(blocksNone.some((block) => (block.text ?? '').includes('TOP10'))).toBe(false);
  });

  it('prints the legacy unrecorded row only when its amount is non-zero', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n,
        tableSessionId: null,
        businessDate: new Date('2026-08-15T00:00:00.000Z'),
        completedAt: new Date('2026-08-15T12:00:00.000Z'),
        paymentMethod: null,
        totalAmountVnd: 100_000n,
        itemAmountVnd: 100_000n,
        deliveryFeeVnd: 0n,
        discountPayableRateBps: null,
        discountAmountVnd: null,
        roundingAmountVnd: null,
        tableSession: null,
        items: [],
      },
    ]);
    const createBusinessSummaryPrintJob = jest.fn().mockResolvedValue({ id: 56n });
    const service = new MerchantOrdersService(
      {
        merchant: { findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          nameZh: '测试店',
          nameVi: null,
          businessHours: { saturday: ['15:00-01:00'] },
        }) },
        order: { findMany },
      } as never,
      { createBusinessSummaryPrintJob } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.printBusinessDaySummary(7n, 3n, '2026-08-15', 'print-key-002');
    const blocks = createBusinessSummaryPrintJob.mock.calls[0]![0].blocks as Array<{
      left?: string;
      right?: string;
    }>;
    expect(blocks.some((block) => block.left?.includes('历史未记录'))).toBe(true);
  });
});
