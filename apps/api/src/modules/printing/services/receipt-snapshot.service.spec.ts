import { BadRequestException } from '@nestjs/common';
import { ReceiptDocument } from '../types/receipt-document';
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
      customerRemark: null,
    });

    await service.fromOrder(merchantId, 37n);

    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 37n, merchantId } }),
    );
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
