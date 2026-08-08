import {
  createPrintDocumentV2,
  renderPrintDocumentV2,
} from './print-document-renderer';
import { printDocumentLines } from './cloud-receipt-renderer';
import {
  DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
  ReceiptDocument,
  ReceiptTemplateDisplaySettings,
} from '../types/receipt-document';
import { PrintDocumentV2 } from '../types/print-document';

describe('PrintDocument V2 server renderer', () => {
  it('renders current rounding as presentation rows without exposing business JSON', () => {
    const document = renderPrintDocumentV2({
      receipt: receipt({ subtotal: 513_000, discount: 3_000, roundingAmount: 3_000, receivedAmount: 510_000, total: 510_000 }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    });
    const serialized = JSON.stringify(document);
    const lines = printDocumentLines(document);

    expect(document.schemaVersion).toBe(2);
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('小计 / Tạm tính'),
      expect.stringContaining('抹零 / Làm tròn'),
      expect.stringContaining('最终应收 / Phải thu'),
    ]));
    expect(lines.join('\n')).toContain('513.000 VND');
    expect(lines.join('\n')).toContain('-3.000 VND');
    expect(lines.join('\n')).toContain('510.000 VND');
    expect(serialized).not.toContain('roundingAmount');
    expect(serialized).not.toContain('receiptType');
    expect(serialized).not.toContain('tableSession');
  });

  it('renders commercial discount separately from legacy rounding on TABLE_BILL only', () => {
    const tableBill = tableBillReceipt({
      subtotal: 513_000,
      commercialDiscountAmount: 51_300,
      discount: 1_700,
      roundingAmount: 1_700,
      receivedAmount: 460_000,
      total: 460_000,
    });
    const tableContent = renderedContent(renderPrintDocumentV2({
      receipt: tableBill,
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    }));
    const orderContent = renderedContent(renderPrintDocumentV2({
      receipt: receipt({
        subtotal: 513_000,
        commercialDiscountAmount: 51_300,
        roundingAmount: 1_700,
        total: 460_000,
      }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    }));

    expect(tableContent).toContain('折扣优惠 / Giảm giá -51.300 VND');
    expect(tableContent).toContain('抹零 / Làm tròn -1.700 VND');
    expect(tableContent).toContain('最终应收 / Phải thu 460.000 VND');
    expect(orderContent).not.toContain('折扣优惠 / Giảm giá');
  });

  it('keeps the historical totals.discount field as rounding only', () => {
    const content = renderedContent(renderPrintDocumentV2({
      receipt: tableBillReceipt({
        subtotal: 513_000,
        discount: 3_000,
        total: 510_000,
      }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    }));

    expect(content).not.toContain('折扣优惠 / Giảm giá');
    expect(content).toContain('抹零 / Làm tròn -3.000 VND');
  });

  it('models a future discount as an ordinary ROW and allows server-only wording changes', () => {
    const build = (discountLabel: string) => createPrintDocumentV2('MM80', [
      { type: 'ROW', left: '小计', right: '828,000 VND', bold: false },
      { type: 'ROW', left: discountLabel, right: '-82,800 VND', bold: false },
      { type: 'ROW', left: '抹零', right: '-5,200 VND', bold: false },
      { type: 'ROW', left: '最终应收', right: '740,000 VND', bold: true },
    ]);
    const nineTenths = build('折扣（9折）');
    const promotion = build('优惠 10%');

    expect(nineTenths.blocks[1]).toEqual({
      type: 'ROW', left: '折扣（9折）', right: '-82,800 VND', bold: false,
    });
    expect(promotion.blocks[1]).toEqual({
      type: 'ROW', left: '优惠 10%', right: '-82,800 VND', bold: false,
    });
    expect(nineTenths.blocks.slice(2)).toEqual(promotion.blocks.slice(2));
    expect(JSON.stringify(nineTenths)).not.toContain('discountAmount');
  });

  it('keeps every historical ORDER_CUSTOMER field visible when display settings are absent', () => {
    const document = renderPrintDocumentV2({
      receipt: receipt({ subtotal: 40_000, total: 40_000 }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    });
    const content = renderedContent(document);

    expect(content).toContain('花悦餐厅');
    expect(content).toContain('订单 / Đơn A-1');
    expect(content).toContain('桌台 / Bàn D10');
    expect(content).toContain('下单时间 / Đặt lúc');
    expect(content).toContain('订单备注 / Ghi chú: 整单少辣');
    expect(content).toContain('单价 / Đơn giá');
    expect(content).toContain('金额 / Thành tiền');
    expect(content).toContain('最终应收 / Phải thu');
    expect(content).toContain('自定义结束语');
    expect(content).toContain('Lời cảm ơn tùy chỉnh');
  });

  it('hides order number independently from order time and note', () => {
    const content = renderedContent(renderCustomer({ orderNumber: false }));

    expect(content).not.toContain('订单 / Đơn A-1');
    expect(content).toContain('下单时间 / Đặt lúc');
    expect(content).toContain('订单备注 / Ghi chú: 整单少辣');
  });

  it('hides order time independently from order number and note', () => {
    const content = renderedContent(renderCustomer({ orderTime: false }));

    expect(content).not.toContain('下单时间 / Đặt lúc');
    expect(content).toContain('订单 / Đơn A-1');
    expect(content).toContain('订单备注 / Ghi chú: 整单少辣');
  });

  it('hides the order note without hiding item notes or leaving empty content blocks', () => {
    const document = renderCustomer({ note: false });
    const content = renderedContent(document);

    expect(content).not.toContain('订单备注 / Ghi chú: 整单少辣');
    expect(content).toContain('备注 / Ghi chú: 少辣');
    expect(document.blocks).not.toContainEqual(expect.objectContaining({ type: 'TEXT', text: '' }));
  });

  it('hides table number independently', () => {
    const content = renderedContent(renderCustomer({ tableNumber: false }));

    expect(content).not.toContain('桌台 / Bàn D10');
    expect(content).toContain('订单 / Đơn A-1');
  });

  it('keeps item names and quantities when item prices are hidden', () => {
    const content = renderedContent(renderCustomer({ itemPrice: false }));

    expect(content).toContain('牛肉粉');
    expect(content).toContain('数量 / Số lượng 1');
    expect(content).not.toContain('单价 / Đơn giá');
    expect(content).not.toContain('金额 / Thành tiền');
  });

  it('hides all order total rows when orderTotal is disabled', () => {
    const content = renderedContent(renderCustomer({ orderTotal: false }));

    expect(content).not.toMatch(/小计 \/ Tạm tính|服务费 \/ Phí dịch vụ|抹零 \/ Làm tròn|最终应收 \/ Phải thu/);
    expect(content).toContain('牛肉粉');
  });

  it('hides merchant name blocks without hiding unrelated merchant contact content', () => {
    const content = renderedContent(renderCustomer({ merchantName: false }));

    expect(content).not.toContain('花悦餐厅');
    expect(content).not.toContain('Nhà hàng Hoa Việt');
    expect(content).toContain('0900000000');
  });

  it('hides both footer lines when footer is disabled', () => {
    const content = renderedContent(renderCustomer({ footer: false }));

    expect(content).not.toContain('自定义结束语');
    expect(content).not.toContain('Lời cảm ơn tùy chỉnh');
    expect(content).not.toContain('谢谢惠顾，欢迎再次光临');
  });

  it.each([
    ['ORDER_CUSTOMER', receipt({ subtotal: 40_000, total: 40_000 })],
    ['TABLE_BILL', tableBillReceipt()],
  ] as const)('renders one explicit footer line for %s without restoring the missing language', (_, value) => {
    const document = renderPrintDocumentV2({
      receipt: { ...value, footer: { zh: '仅一行结束语', vi: '' } },
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    });
    const footerBlocks = document.blocks.filter(
      (block) => block.type === 'TEXT' && block.align === 'CENTER',
    );

    expect(footerBlocks).toContainEqual(expect.objectContaining({ text: '仅一行结束语' }));
    expect(renderedContent(document)).not.toContain('Cảm ơn quý khách, hẹn gặp lại!');
    expect(document.blocks).not.toContainEqual(expect.objectContaining({ type: 'TEXT', text: '' }));
  });

  it('combines disabled fields without empty ROWs or orphan DIVIDER blocks', () => {
    const document = renderCustomer({
      merchantName: false,
      orderNumber: false,
      tableNumber: false,
      orderTime: false,
      note: false,
      itemPrice: false,
      orderTotal: false,
      footer: false,
    });
    const printable = document.blocks.filter((block) => block.type !== 'FEED' && block.type !== 'CUT');

    expect(renderedContent(document)).toContain('牛肉粉');
    expect(printable[0]?.type).not.toBe('DIVIDER');
    expect(printable.at(-1)?.type).not.toBe('DIVIDER');
    printable.forEach((block, index) => {
      if (block.type === 'ROW') {
        expect(block.left.trim()).not.toBe('');
        expect(block.right.trim()).not.toBe('');
      }
      if (block.type === 'DIVIDER') expect(printable[index - 1]?.type).not.toBe('DIVIDER');
    });
    expect(document.blocks.at(-2)).toEqual({ type: 'FEED', lines: 3 });
    expect(document.blocks.at(-1)).toEqual({ type: 'CUT', mode: 'HALF' });
  });

  it('keeps every historical TABLE_BILL field visible when display settings are absent', () => {
    const content = renderedContent(renderTableBill());

    expect(content).toContain('花悦餐厅');
    expect(content).toContain('桌台 / Bàn D10');
    expect(content).toContain('桌账 / Phiên bàn TS-D10');
    expect(content).toContain('订单数 / Số đơn 2');
    expect(content).toContain('订单 / Đơn: A-1, A-2');
    expect(content).toContain('开台时间 / Mở bàn');
    expect(content).toContain('结账时间 / Thanh toán');
    expect(content).toContain('生成时间 / Tạo lúc');
    expect(content).toContain('单价 / Đơn giá');
    expect(content).toContain('最终应收 / Phải thu');
    expect(content).toContain('自定义结束语');
  });

  it('applies TABLE_BILL merchant, order-info, table, and time visibility independently', () => {
    const merchantHidden = renderedContent(renderTableBill({ merchantName: false }));
    expect(merchantHidden).not.toContain('花悦餐厅');
    expect(merchantHidden).not.toContain('Nhà hàng Hoa Việt');
    expect(merchantHidden).toContain('0900000000');

    const orderInfoHidden = renderedContent(renderTableBill({ orderNumber: false }));
    expect(orderInfoHidden).not.toContain('订单数 / Số đơn');
    expect(orderInfoHidden).not.toContain('订单 / Đơn:');
    expect(orderInfoHidden).toContain('桌账 / Phiên bàn TS-D10');
    expect(orderInfoHidden).toContain('桌台 / Bàn D10');

    const tableHidden = renderedContent(renderTableBill({ tableNumber: false }));
    expect(tableHidden).not.toContain('桌台 / Bàn D10');
    expect(tableHidden).toContain('桌账 / Phiên bàn TS-D10');

    const timeHidden = renderedContent(renderTableBill({ orderTime: false }));
    expect(timeHidden).not.toMatch(/开台时间 \/ Mở bàn|结账时间 \/ Thanh toán|生成时间 \/ Tạo lúc/);
    expect(timeHidden).toContain('桌账 / Phiên bàn TS-D10');
    expect(timeHidden).toContain('牛肉粉');
  });

  it('keeps TABLE_BILL items and quantities while hiding item prices', () => {
    const content = renderedContent(renderTableBill({ itemPrice: false }));

    expect(content).toContain('牛肉粉');
    expect(content).toContain('数量 / Số lượng 1');
    expect(content).not.toContain('单价 / Đơn giá');
    expect(content).not.toContain('金额 / Thành tiền');
    expect(content).toContain('备注 / Ghi chú: 少辣');
  });

  it('hides TABLE_BILL totals and footer independently', () => {
    const totalsHidden = renderedContent(renderTableBill({ orderTotal: false }));
    expect(totalsHidden).not.toMatch(/小计 \/ Tạm tính|折扣优惠 \/ Giảm giá|服务费 \/ Phí dịch vụ|抹零 \/ Làm tròn|最终应收 \/ Phải thu/);
    expect(totalsHidden).toContain('牛肉粉');

    const footerHidden = renderedContent(renderTableBill({ footer: false }));
    expect(footerHidden).not.toContain('自定义结束语');
    expect(footerHidden).not.toContain('Lời cảm ơn tùy chỉnh');
    expect(footerHidden).toContain('最终应收 / Phải thu');
  });

  it('combines TABLE_BILL display flags without empty rows or orphan dividers', () => {
    const document = renderTableBill({
      merchantName: false,
      orderNumber: false,
      tableNumber: false,
      orderTime: false,
      note: false,
      itemPrice: false,
      orderTotal: false,
      footer: false,
    });
    const printable = document.blocks.filter((block) => block.type !== 'FEED' && block.type !== 'CUT');
    const content = renderedContent(document);

    expect(content).toContain('结账小票 / Hóa đơn thanh toán');
    expect(content).toContain('桌账 / Phiên bàn TS-D10');
    expect(content).toContain('牛肉粉');
    expect(content).toContain('数量 / Số lượng 1');
    expect(printable[0]?.type).not.toBe('DIVIDER');
    expect(printable.at(-1)?.type).not.toBe('DIVIDER');
    printable.forEach((block, index) => {
      if (block.type === 'ROW') {
        expect(block.left.trim()).not.toBe('');
        expect(block.right.trim()).not.toBe('');
      }
      if (block.type === 'DIVIDER') expect(printable[index - 1]?.type).not.toBe('DIVIDER');
    });
    expect(document.blocks.at(-2)).toEqual({ type: 'FEED', lines: 3 });
    expect(document.blocks.at(-1)).toEqual({ type: 'CUT', mode: 'HALF' });
  });

  it('renders kitchen documents with only item name quantity and note content', () => {
    const document = renderPrintDocumentV2({
      receipt: receipt({ subtotal: 828_000, total: 828_000 }),
      paperWidth: 'MM58',
      purpose: 'KITCHEN',
    });
    const lines = printDocumentLines(document).join('\n');

    expect(lines).toContain('牛肉粉');
    expect(lines).toContain('Phở bò');
    expect(lines).toContain('数量 / Số lượng');
    expect(lines).toContain('备注 / Ghi chú: 少辣');
    expect(lines).not.toMatch(/小计|折扣|抹零|最终应收|VND/);
  });

  it('uses the ORDER customer renderer for an explicit category rendering context', () => {
    const document = renderPrintDocumentV2({
      receipt: receipt({ subtotal: 150_000, total: 150_000 }),
      paperWidth: 'MM58',
      purpose: 'KITCHEN',
      renderMode: 'CUSTOMER',
      display: display({ note: false, itemPrice: false, orderTotal: true, footer: true }),
    });
    const lines = printDocumentLines(document).join('\n');

    expect(lines).toContain('顾客小票 / Hóa đơn khách hàng');
    expect(lines).toContain('订单 / Đơn');
    expect(lines).toContain('备注 / Ghi chú: 少辣');
    expect(lines).not.toContain('订单备注 / Ghi chú: 整单少辣');
    expect(lines).not.toContain('单价 / Đơn giá');
    expect(lines).toContain('最终应收 / Phải thu');
    expect(lines).toContain('自定义结束语');
  });
});

function receipt(totals: Omit<ReceiptDocument['totals'], 'currency'>): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'ORDER_CUSTOMER',
    generatedAt: '2026-08-07T10:00:00.000Z',
    merchant: {
      id: '11', name: '花悦餐厅', nameVi: 'Nhà hàng Hoa Việt', phone: '0900000000',
    },
    order: {
      id: '20', orderNo: 'A-1', orderType: 'DINE_IN', tableName: 'D10',
      createdAt: '2026-08-07T09:55:00.000Z',
    },
    items: [{
      name: '牛肉粉', nameVi: 'Phở bò', quantity: 1,
      unitPrice: totals.subtotal, lineTotal: totals.subtotal, note: '少辣',
    }],
    totals: { ...totals, currency: 'VND' },
    note: '整单少辣',
    footer: { zh: '自定义结束语', vi: 'Lời cảm ơn tùy chỉnh' },
  };
}

function tableBillReceipt(
  totals: Omit<ReceiptDocument['totals'], 'currency'> = { subtotal: 40_000, total: 40_000 },
): ReceiptDocument {
  const document = receipt(totals);
  return {
    ...document,
    receiptType: 'TABLE_BILL',
    order: undefined,
    tableSession: {
      id: '30',
      sessionNo: 'TS-D10',
      tableName: 'D10',
      openedAt: '2026-08-07T09:00:00.000Z',
      closedAt: '2026-08-07T10:00:00.000Z',
      orderNos: ['A-1', 'A-2'],
    },
  };
}

function renderTableBill(overrides?: Partial<ReceiptTemplateDisplaySettings>) {
  return renderPrintDocumentV2({
    receipt: tableBillReceipt(),
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    ...(overrides ? { display: display(overrides) } : {}),
  });
}

function renderCustomer(overrides: Partial<ReceiptTemplateDisplaySettings>) {
  return renderPrintDocumentV2({
    receipt: receipt({ subtotal: 40_000, serviceFee: 2_000, roundingAmount: 2_000, total: 40_000 }),
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    display: display(overrides),
  });
}

function display(overrides: Partial<ReceiptTemplateDisplaySettings>) {
  return { ...DEFAULT_RECEIPT_TEMPLATE_DISPLAY, ...overrides };
}

function renderedContent(document: PrintDocumentV2) {
  return document.blocks.flatMap((block) => {
    if (block.type === 'TEXT') return [block.text];
    if (block.type === 'ROW') return [`${block.left} ${block.right}`];
    return [];
  }).join('\n');
}
