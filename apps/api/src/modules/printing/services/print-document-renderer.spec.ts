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

  it('does not apply ORDER_CUSTOMER display flags to TABLE_BILL rendering', () => {
    const document = renderPrintDocumentV2({
      receipt: tableBillReceipt(),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
      display: display({
        merchantName: false,
        tableNumber: false,
        itemPrice: false,
        orderTotal: false,
        footer: false,
      }),
    });
    const content = renderedContent(document);

    expect(content).toContain('花悦餐厅');
    expect(content).toContain('桌台 / Bàn D10');
    expect(content).toContain('单价 / Đơn giá');
    expect(content).toContain('最终应收 / Phải thu');
    expect(content).toContain('自定义结束语');
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

function tableBillReceipt(): ReceiptDocument {
  const document = receipt({ subtotal: 40_000, total: 40_000 });
  return {
    ...document,
    receiptType: 'TABLE_BILL',
    order: undefined,
    tableSession: {
      id: '30',
      sessionNo: 'TS-D10',
      tableName: 'D10',
      openedAt: '2026-08-07T09:00:00.000Z',
      orderNos: ['A-1'],
    },
  };
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
