import { renderCloudReceipt, receiptLines } from './cloud-receipt-renderer';
import { ReceiptDocument } from '../types/receipt-document';

describe('cloud receipt renderer', () => {
  it('renders a fixed Chinese and Vietnamese customer receipt for both providers', () => {
    const document = orderReceipt();

    const yilian = renderCloudReceipt(document, 'YILIAN');
    const feie = renderCloudReceipt(document, 'FEIE');

    expect(yilian).toContain('顾客小票 / Hóa đơn khách hàng');
    expect(yilian).toContain('数量 / Số lượng: 2');
    expect(yilian).toContain('谢谢惠顾，欢迎再次光临');
    expect(yilian).toContain('Cảm ơn quý khách, hẹn gặp lại!');
    expect(feie).toContain('<BR>');
    expect(feie).toContain('顾客小票 / Hóa đơn khách hàng');
  });

  it('renders the settled whole-table 513000 / 3000 / 510000 result', () => {
    const lines = receiptLines(tableReceipt());

    expect(lines).toEqual(
      expect.arrayContaining([
        '结账小票 / Hóa đơn thanh toán',
        '订单数 / Số đơn: 2',
        '原金额 / Tổng tiền ban đầu: 513.000 VND',
        '抹零 / Làm tròn: 3.000 VND',
        '实收 / Thực thu: 510.000 VND',
      ]),
    );
  });

  it('escapes merchant data before adding Feie control tags', () => {
    const document = orderReceipt();
    document.merchant.name = '<B>不可注入</B> & Store';

    const content = renderCloudReceipt(document, 'FEIE');

    expect(content).toContain('&lt;B&gt;不可注入&lt;/B&gt; &amp; Store');
    expect(content).not.toContain('<B>不可注入</B>');
  });

  it('sends the same PrintDocument V2 rows through both cloud adapters', () => {
    const document = {
      documentType: 'PRINT_DOCUMENT' as const,
      schemaVersion: 2 as const,
      paperWidth: 'MM80' as const,
      copies: 1,
      blocks: [
        { type: 'ROW' as const, left: '折扣（9折）', right: '-82,800 VND', bold: false },
        { type: 'ROW' as const, left: '最终应收', right: '740,000 VND', bold: true },
      ],
    };

    expect(renderCloudReceipt(document, 'YILIAN')).toContain('折扣（9折）');
    expect(renderCloudReceipt(document, 'FEIE')).toContain('740,000 VND');
  });

  it('flattens schema 3 TABLE_BILL layout without changing cloud provider routing', () => {
    const document = {
      documentType: 'PRINT_DOCUMENT' as const,
      schemaVersion: 3 as const,
      paperWidth: 'MM80' as const,
      copies: 1,
      blocks: [
        {
          type: 'BOXED_TITLE' as const,
          boxText: 'A01', title: '结账小票/Hóa đơn thanh toán', subtitle: 'TS-A01',
          boxWeight: 24, gapDots: 10, fontSize: 'NORMAL' as const,
        },
        {
          type: 'COLUMNS' as const,
          gapDots: 8,
          cells: [
            { text: 'Món', weight: 48, align: 'LEFT' as const, bold: true, fontSize: 'SMALL' as const, overflow: 'FIT' as const, paddingDots: 0 },
            { text: 'Đơn giá', weight: 20, align: 'RIGHT' as const, bold: true, fontSize: 'SMALL' as const, overflow: 'FIT' as const, paddingDots: 0 },
            { text: 'SL', weight: 8, align: 'CENTER' as const, bold: true, fontSize: 'SMALL' as const, overflow: 'FIT' as const, paddingDots: 0 },
            { text: 'Thành tiền', weight: 24, align: 'RIGHT' as const, bold: true, fontSize: 'SMALL' as const, overflow: 'FIT' as const, paddingDots: 0 },
          ],
        },
      ],
    };

    expect(renderCloudReceipt(document, 'YILIAN')).toContain('[A01]');
    expect(renderCloudReceipt(document, 'YILIAN')).toContain('Món  Đơn giá  SL  Thành tiền');
    expect(renderCloudReceipt(document, 'FEIE')).toContain('结账小票/Hóa đơn thanh toán');
  });
});

function orderReceipt(): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'ORDER_CUSTOMER',
    generatedAt: '2026-07-28T10:00:00.000Z',
    merchant: { id: '7', name: '云桥餐厅', nameVi: 'Nhà hàng YunQiao' },
    order: {
      id: '91',
      orderNo: 'YQ-91',
      orderType: 'DINE_IN',
      tableName: 'A01',
      createdAt: '2026-07-28T09:55:00.000Z',
    },
    items: [
      {
        name: '牛肉粉',
        nameVi: 'Phở bò',
        quantity: 2,
        unitPrice: 50_000,
        lineTotal: 100_000,
      },
    ],
    totals: { subtotal: 100_000, total: 100_000, currency: 'VND' },
    footer: {
      zh: '谢谢惠顾，欢迎再次光临',
      vi: 'Cảm ơn quý khách, hẹn gặp lại!',
    },
  };
}

function tableReceipt(): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'TABLE_BILL',
    generatedAt: '2026-07-28T10:30:00.000Z',
    merchant: { id: '7', name: '云桥餐厅', nameVi: 'Nhà hàng YunQiao' },
    tableSession: {
      id: '17',
      sessionNo: 'TS-17',
      tableName: 'A01',
      openedAt: '2026-07-28T09:00:00.000Z',
      closedAt: '2026-07-28T10:30:00.000Z',
      orderNos: ['YQ-91', 'YQ-92'],
    },
    items: [
      {
        name: '整桌菜品',
        nameVi: 'Món của cả bàn',
        quantity: 1,
        unitPrice: 513_000,
        lineTotal: 513_000,
      },
    ],
    totals: {
      subtotal: 513_000,
      originalAmount: 513_000,
      roundingAmount: 3_000,
      receivedAmount: 510_000,
      total: 510_000,
      currency: 'VND',
    },
  };
}
