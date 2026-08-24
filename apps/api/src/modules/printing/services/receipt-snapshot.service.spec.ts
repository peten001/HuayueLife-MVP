import { BadRequestException } from '@nestjs/common';
import {
  assertReceiptTemplateDefinition,
  DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
  ReceiptDocument,
} from '../types/receipt-document';
import { PrintDocumentV3 } from '../types/print-document';
import { ReceiptSnapshotService } from './receipt-snapshot.service';

const merchantId = 7n;

describe('ReceiptSnapshotService validation', () => {
  let prisma: { order: { findFirst: jest.Mock }; tableSession: { findFirst: jest.Mock } };
  let service: ReceiptSnapshotService;

  beforeEach(() => {
    prisma = {
      order: { findFirst: jest.fn() },
      tableSession: { findFirst: jest.fn() },
    };
    service = new ReceiptSnapshotService(prisma as never);
  });

  it('creates an immutable JSON clone for a valid merchant-scoped receipt', () => {
    const source = validReceipt();
    const snapshot = service.cloneAndValidate(source);

    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.merchant)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0])).toBe(true);
  });

  it('clones and freezes a strict schema 3 print snapshot without rewriting it', () => {
    const source: PrintDocumentV3 = {
      documentType: 'PRINT_DOCUMENT',
      schemaVersion: 3,
      paperWidth: 'MM58',
      copies: 1,
      blocks: [{
        type: 'COLUMNS',
        gapDots: 6,
        cells: [
          { text: 'Món', weight: 82, align: 'LEFT', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
          { text: 'SL', weight: 18, align: 'CENTER', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
        ],
      }],
    };

    const snapshot = service.cloneAndValidate(source);

    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.blocks[0])).toBe(true);
  });

  it('adds the stable bilingual footer without changing the receipt schema version', () => {
    const snapshot = service.withTemplate(validReceipt(), {
      schemaVersion: 1,
      sections: [{ type: 'FOOTER' }],
      footerTextZh: '谢谢惠顾，欢迎再次光临',
      footerTextVi: 'Cảm ơn quý khách, hẹn gặp lại!',
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.footer).toEqual({
      zh: '谢谢惠顾，欢迎再次光临',
      vi: 'Cảm ơn quý khách, hẹn gặp lại!',
    });
    expect(Object.isFrozen(snapshot.footer)).toBe(true);
  });

  it('preserves an explicitly empty second footer line', () => {
    const snapshot = service.withTemplate(validReceipt(), {
      schemaVersion: 1,
      sections: [{ type: 'FOOTER' }],
      footerTextZh: '仅一行结束语',
      footerTextVi: '',
    });

    expect(snapshot.footer).toEqual({ zh: '仅一行结束语', vi: '' });
  });

  it('keeps default bilingual footer values when historical fields are missing', () => {
    const snapshot = service.withTemplate(validReceipt(), {
      schemaVersion: 1,
      sections: [{ type: 'FOOTER' }],
    });

    expect(snapshot.footer).toEqual({
      zh: '谢谢惠顾，欢迎再次光临',
      vi: 'Cảm ơn quý khách, hẹn gặp lại!',
    });
  });

  it('accepts the exact 121-character compatibility footer boundary', () => {
    expect(() => assertReceiptTemplateDefinition({
      schemaVersion: 1,
      sections: [{ type: 'FOOTER' }],
      footerTextZh: '中'.repeat(60),
      footerTextVi: 'V'.repeat(60),
      footerText: `${'中'.repeat(60)}\n${'V'.repeat(60)}`,
    })).not.toThrow();
    expect(() => assertReceiptTemplateDefinition({
      schemaVersion: 1,
      sections: [{ type: 'FOOTER' }],
      footerText: 'x'.repeat(122),
    })).toThrow('Template definition must use schemaVersion 1 and sections');
  });

  it('defaults every fine-grained display setting to visible for historical definitions', () => {
    expect(service.displaySettingsFromTemplate({
      schemaVersion: 1,
      sections: [{ type: 'ITEMS' }],
    })).toEqual(DEFAULT_RECEIPT_TEMPLATE_DISPLAY);
  });

  it('normalizes independent display settings from an applied template definition', () => {
    expect(service.displaySettingsFromTemplate({
      schemaVersion: 1,
      sections: [{ type: 'ITEMS' }],
      display: {
        orderNumber: false,
        orderTime: true,
        note: false,
        itemPrice: false,
      },
    })).toEqual({
      ...DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
      orderNumber: false,
      orderTime: true,
      note: false,
      itemPrice: false,
    });
  });

  it('ignores malformed runtime display values instead of crashing snapshot rendering', () => {
    expect(service.displaySettingsFromTemplate({
      display: {
        merchantName: false,
        orderNumber: 'false',
        unsupported: false,
      },
    })).toEqual({
      ...DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
      merchantName: false,
    });
  });

  it.each([
    {
      name: 'wrong context for receipt type',
      mutate: (document: Record<string, unknown>) => {
        document.tableSession = {
          id: '47',
          sessionNo: 'TS-47',
          tableName: 'A01',
          openedAt: '2026-07-15T00:00:00.000Z',
          orderNos: [],
        };
      },
    },
    {
      name: 'empty item list',
      mutate: (document: Record<string, unknown>) => {
        document.items = [];
      },
    },
    {
      name: 'negative amount',
      mutate: (document: Record<string, unknown>) => {
        document.totals = { subtotal: 1000, total: -1, currency: 'VND' };
      },
    },
    {
      name: 'unsafe integer quantity',
      mutate: (document: Record<string, unknown>) => {
        document.items = [
          {
            name: '测试菜品',
            quantity: Number.MAX_SAFE_INTEGER + 1,
            unitPrice: 1000,
            lineTotal: 1000,
          },
        ];
      },
    },
    {
      name: 'invalid merchant identifier',
      mutate: (document: Record<string, unknown>) => {
        document.merchant = { id: 'merchant-7', name: '测试商家' };
      },
    },
    {
      name: 'unknown top-level customer field',
      mutate: (document: Record<string, unknown>) => {
        document.customer = { phone: 'must-not-enter-snapshot' };
      },
    },
    {
      name: 'unknown nested merchant secret field',
      mutate: (document: Record<string, unknown>) => {
        (document.merchant as Record<string, unknown>).secret = 'must-not-enter-snapshot';
      },
    },
    {
      name: 'unknown nested order customer field',
      mutate: (document: Record<string, unknown>) => {
        (document.order as Record<string, unknown>).customer = {
          phone: 'must-not-enter-snapshot',
        };
      },
    },
    {
      name: 'unknown nested item secret field',
      mutate: (document: Record<string, unknown>) => {
        const items = document.items as Array<Record<string, unknown>>;
        items[0].secret = 'must-not-enter-snapshot';
      },
    },
    {
      name: 'more than 500 receipt items',
      mutate: (document: Record<string, unknown>) => {
        const item = (document.items as Array<Record<string, unknown>>)[0];
        document.items = Array.from({ length: 501 }, () => ({ ...item }));
      },
    },
    {
      name: 'more than 1000 table session order numbers',
      mutate: (document: Record<string, unknown>) => {
        document.receiptType = 'TABLE_BILL';
        delete document.order;
        document.tableSession = {
          id: '47',
          sessionNo: 'TS-47',
          tableName: 'A01',
          openedAt: '2026-07-15T00:00:00.000Z',
          orderNos: Array.from({ length: 1_001 }, (_, index) => `ORDER-${index}`),
        };
      },
    },
    {
      name: 'invalid optional order completion date',
      mutate: (document: Record<string, unknown>) => {
        (document.order as Record<string, unknown>).completedAt = 'not-a-date';
      },
    },
    {
      name: 'overlong optional merchant address',
      mutate: (document: Record<string, unknown>) => {
        (document.merchant as Record<string, unknown>).address = 'x'.repeat(301);
      },
    },
    {
      name: 'overlong optional localized item name',
      mutate: (document: Record<string, unknown>) => {
        const items = document.items as Array<Record<string, unknown>>;
        items[0].nameVi = 'x'.repeat(121);
      },
    },
    {
      name: 'overlong optional receipt note',
      mutate: (document: Record<string, unknown>) => {
        document.note = 'x'.repeat(501);
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const malformed = JSON.parse(JSON.stringify(validReceipt())) as Record<
      string,
      unknown
    >;
    mutate(malformed);

    expect(() => service.cloneAndValidate(malformed as never)).toThrow(
      BadRequestException,
    );
  });

  it('queries order data with both order and merchant scope', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 37n,
      merchantId,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        addressZh: '测试地址',
        addressDetail: null,
        contactPhone: '0900000000',
      },
      table: { tableNo: 'A01', tableName: null },
      tableNoSnapshot: 'A01',
      orderNo: 'TEST-ORDER',
      orderType: 'DINE_IN',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      completedAt: null,
      items: [
        {
          productNameZhSnapshot: '测试菜品',
          product: { nameVi: 'Mon thu' },
          quantity: 1,
          unitPriceVnd: 1000n,
          subtotalVnd: 1000n,
          remark: null,
        },
      ],
      itemAmountVnd: 1000n,
      totalAmountVnd: 1000n,
      roundingAmountVnd: 0n,
      roundingAppliedByStaffId: null,
      roundingAppliedAt: null,
      customerRemark: null,
    });

    await service.fromOrder(merchantId, 37n);

    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 37n, merchantId } }),
    );
  });

  it('keeps only selected category items and totals in a category snapshot', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 40n,
      merchantId,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        nameVi: null,
        addressZh: null,
        addressDetail: null,
        contactPhone: null,
      },
      table: { tableNo: 'A01', tableName: null },
      tableNoSnapshot: 'A01',
      orderNo: 'CATEGORY-40',
      orderType: 'DINE_IN',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      completedAt: null,
      items: [
        {
          productNameZhSnapshot: '分类 A 商品 1',
          product: { nameVi: 'Món A1', categoryId: 81n },
          quantity: 1,
          unitPriceVnd: 1000n,
          subtotalVnd: 1000n,
          remark: '商品备注 A1',
        },
        {
          productNameZhSnapshot: '分类 A 商品 2',
          product: { nameVi: 'Món A2', categoryId: 81n },
          quantity: 1,
          unitPriceVnd: 500n,
          subtotalVnd: 500n,
          remark: null,
        },
        {
          productNameZhSnapshot: '分类 B 商品',
          product: { nameVi: 'Món B', categoryId: 82n },
          quantity: 1,
          unitPriceVnd: 1500n,
          subtotalVnd: 1500n,
          remark: null,
        },
      ],
      itemAmountVnd: 3000n,
      totalAmountVnd: 3000n,
      roundingAmountVnd: 0n,
      roundingAppliedByStaffId: null,
      roundingAppliedAt: null,
      customerRemark: '整单备注',
    });

    const snapshot = await service.fromOrder(merchantId, 40n, [81n]);

    expect(snapshot.items.map((item) => item.name)).toEqual(['分类 A 商品 1', '分类 A 商品 2']);
    expect(snapshot.items[0]?.note).toBe('商品备注 A1');
    expect(snapshot.items.map((item) => item.name)).not.toContain('分类 B 商品');
    expect(snapshot.totals).toEqual(expect.objectContaining({
      subtotal: 1500,
      originalAmount: 1500,
      roundingAmount: 0,
      receivedAmount: 1500,
      total: 1500,
    }));
  });

  it('prints pickup rounding from the persisted order amount fields', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 38n,
      merchantId,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        addressZh: '测试地址',
        addressDetail: null,
        contactPhone: '0900000000',
      },
      table: null,
      tableNoSnapshot: null,
      orderNo: 'TEST-PICKUP-38',
      orderType: 'PICKUP',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      completedAt: null,
      items: [
        {
          productNameZhSnapshot: '抹零自取菜品',
          product: { nameVi: 'Mon tu lay' },
          quantity: 1,
          unitPriceVnd: 513_000n,
          subtotalVnd: 513_000n,
          remark: null,
        },
      ],
      itemAmountVnd: 513_000n,
      totalAmountVnd: 513_000n,
      roundingAmountVnd: 3_000n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date('2026-07-15T00:01:00.000Z'),
      customerRemark: null,
    });

    const snapshot = await service.fromOrder(merchantId, 38n);

    expect(snapshot.totals).toEqual({
      subtotal: 513_000,
      discount: 3_000,
      originalAmount: 513_000,
      roundingAmount: 3_000,
      receivedAmount: 510_000,
      total: 510_000,
      currency: 'VND',
    });
  });

  it('prints delivery rounding from the same persisted order fields', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 39n,
      merchantId,
      merchant: { id: merchantId, nameZh: '测试商家', addressZh: '测试地址', addressDetail: null, contactPhone: '0900000000' },
      table: null,
      tableNoSnapshot: null,
      orderNo: 'TEST-DELIVERY-39',
      orderType: 'DELIVERY',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      completedAt: null,
      items: [{ productNameZhSnapshot: '配送抹零菜品', product: { nameVi: 'Mon giao hang' }, quantity: 1, unitPriceVnd: 513_000n, subtotalVnd: 513_000n, remark: null }],
      itemAmountVnd: 513_000n,
      totalAmountVnd: 513_000n,
      roundingAmountVnd: 3_000n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date('2026-07-15T00:01:00.000Z'),
      customerRemark: null,
    });

    const snapshot = await service.fromOrder(merchantId, 39n);

    expect(snapshot.order?.orderType).toBe('DELIVERY');
    expect(snapshot.totals).toMatchObject({ originalAmount: 513_000, roundingAmount: 3_000, receivedAmount: 510_000, total: 510_000 });
  });

  it('prints pickup discount and rounding from the persisted Order settlement fields', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 41n,
      merchantId,
      merchant: { id: merchantId, nameZh: '测试商家', addressZh: null, addressDetail: null, contactPhone: null },
      table: null,
      tableNoSnapshot: null,
      orderNo: 'TEST-PICKUP-DISCOUNT-41',
      orderType: 'PICKUP',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      completedAt: new Date('2026-07-15T00:02:00.000Z'),
      items: [{ productNameZhSnapshot: '折扣自取菜品', product: { nameVi: 'Món giảm giá' }, quantity: 1, unitPriceVnd: 536_000n, subtotalVnd: 536_000n, remark: null }],
      itemAmountVnd: 536_000n,
      totalAmountVnd: 536_000n,
      discountPayableRateBps: 9_627,
      discountAmountVnd: 20_000n,
      discountAppliedByStaffId: 11n,
      discountAppliedAt: new Date('2026-07-15T00:01:00.000Z'),
      roundingAmountVnd: 6_000n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date('2026-07-15T00:01:30.000Z'),
      customerRemark: null,
    });

    const snapshot = await service.fromOrder(merchantId, 41n);

    expect(snapshot.totals).toEqual({
      subtotal: 536_000,
      commercialDiscountAmount: 20_000,
      discount: 6_000,
      originalAmount: 536_000,
      roundingAmount: 6_000,
      receivedAmount: 510_000,
      total: 510_000,
      currency: 'VND',
    });
  });

  it('reads one persisted 9,000 VND session rounding for a multi-order 309,000 VND table bill', async () => {
    prisma.tableSession.findFirst.mockResolvedValue({
      id: 47n,
      sessionNo: 'TS-47',
      openedAt: new Date('2026-07-15T00:00:00.000Z'),
      closedAt: null,
      discountAmountVnd: 0n,
      roundingAmountVnd: 9_000n,
      roundingAppliedByStaffId: 11n,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        addressZh: '测试地址',
        addressDetail: null,
        contactPhone: '0900000000',
      },
      table: { tableNo: 'A01', tableName: null },
      orders: Array.from({ length: 3 }, (_, index) => ({
          orderNo: `TEST-TABLE-ORDER-${index + 1}`,
          itemAmountVnd: 103_000n,
          totalAmountVnd: 103_000n,
          items: [
            {
              productNameZhSnapshot: '抹零验收菜品',
              product: { nameVi: 'Mon kiem thu' },
              quantity: 1,
              unitPriceVnd: 103_000n,
              subtotalVnd: 103_000n,
              remark: null,
            },
          ],
        })),
    });

    const snapshot = await service.fromTableSession(merchantId, 47n);

    expect(snapshot.totals).toEqual({
      subtotal: 309_000,
      discount: 9_000,
      originalAmount: 309_000,
      roundingAmount: 9_000,
      receivedAmount: 300_000,
      total: 300_000,
      currency: 'VND',
    });
    expect(snapshot.tableSession?.orderNos).toHaveLength(3);
    expect(prisma.tableSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 47n, merchantId } }),
    );
  });

  it('freezes persisted TABLE_BILL discount and rounding without recalculating them', async () => {
    prisma.tableSession.findFirst.mockResolvedValue({
      id: 48n,
      sessionNo: 'TS-48',
      openedAt: new Date('2026-07-15T00:00:00.000Z'),
      closedAt: null,
      discountPayableRateBps: 9000,
      discountAmountVnd: 50_000n,
      discountAppliedByStaffId: 11n,
      discountAppliedAt: new Date('2026-07-15T00:01:00.000Z'),
      roundingAmountVnd: 1_700n,
      roundingAppliedByStaffId: 11n,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        addressZh: '测试地址',
        addressDetail: null,
        contactPhone: '0900000000',
      },
      table: { tableNo: 'A01', tableName: null },
      orders: [{
        orderNo: 'TEST-DISCOUNTED-TABLE',
        itemAmountVnd: 513_000n,
        totalAmountVnd: 513_000n,
        items: [{
          productNameZhSnapshot: '折扣验收菜品',
          product: { nameVi: 'Món giảm giá' },
          quantity: 1,
          unitPriceVnd: 513_000n,
          subtotalVnd: 513_000n,
          remark: null,
        }],
      }],
    });

    const snapshot = await service.fromTableSession(merchantId, 48n);

    expect(snapshot.totals).toEqual({
      subtotal: 513_000,
      commercialDiscountAmount: 50_000,
      discount: 1_700,
      originalAmount: 513_000,
      roundingAmount: 1_700,
      receivedAmount: 461_300,
      total: 461_300,
      currency: 'VND',
    });
  });
});

function validReceipt(): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'ORDER_CUSTOMER',
    generatedAt: '2026-07-15T00:00:00.000Z',
    merchant: { id: merchantId.toString(), name: '测试商家' },
    order: {
      id: '37',
      orderNo: 'TEST-ORDER',
      orderType: 'DINE_IN',
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    items: [
      { name: '测试菜品', quantity: 1, unitPrice: 1000, lineTotal: 1000 },
    ],
    totals: { subtotal: 1000, total: 1000, currency: 'VND' },
  };
}
