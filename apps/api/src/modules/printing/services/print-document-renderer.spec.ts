import {
  canonicalReceiptDisplaySettings,
  createPrintDocumentV2,
  renderPrintDocumentV2,
  renderPrintDocumentV3,
} from './print-document-renderer';
import { printDocumentLines } from './cloud-receipt-renderer';
import {
  DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
  ReceiptDocument,
  ReceiptTemplateDisplaySettings,
} from '../types/receipt-document';
import { PrintDocument, PrintDocumentV2, PrintDocumentV3 } from '../types/print-document';

describe('PrintDocument V2 server renderer', () => {
  it('limits canonical merchant preferences to content fields only', () => {
    expect(canonicalReceiptDisplaySettings({
      ...DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
      merchantName: false,
      tableNumber: false,
      note: false,
      itemPrice: false,
      orderTotal: false,
      orderNumber: false,
      orderTime: false,
      merchantAddress: false,
      merchantPhone: false,
      footer: false,
    })).toEqual(expect.objectContaining({
      merchantName: true,
      tableNumber: true,
      note: true,
      itemPrice: true,
      orderTotal: true,
      orderNumber: false,
      orderTime: false,
      merchantAddress: false,
      merchantPhone: false,
      footer: false,
    }));
  });

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

  it.each([
    ['undefined', { merchantAddress: undefined, merchantPhone: undefined }],
    ['true', { merchantAddress: true, merchantPhone: true }],
  ] as const)('keeps TABLE_BILL merchant contact visible when the new flag is %s', (_, flags) => {
    const content = renderedContent(renderTableBill(flags));

    expect(content).toContain('真实地址');
    expect(content).toContain('0900000000');
  });

  it('hides TABLE_BILL merchant contacts independently while preserving the merchant name pair', () => {
    const content = renderedContent(renderTableBill({
      merchantAddress: false,
      merchantPhone: false,
    }));

    expect(content).toContain('花悦餐厅');
    expect(content).toContain('Nhà hàng Hoa Việt');
    expect(content).not.toContain('真实地址');
    expect(content).not.toContain('0900000000');
  });

  it('keeps TABLE_BILL item price visibility paired and retains quantity', () => {
    const content = renderedContent(renderTableBill({ itemPrice: false }));

    expect(content).toContain('数量 / Số lượng 1');
    expect(content).toContain('备注 / Ghi chú: 少辣');
    expect(content).not.toContain('单价 / Đơn giá');
    expect(content).not.toContain('金额 / Thành tiền');
  });

  it('renders TABLE_BILL original, conditional discount, rounding, and received totals', () => {
    const content = renderedContent(renderPrintDocumentV2({
      receipt: tableBillReceipt({
        subtotal: 40_000,
        originalAmount: 40_000,
        commercialDiscountAmount: 5_000,
        roundingAmount: 1_000,
        receivedAmount: 34_000,
        total: 34_000,
      }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    }));

    expect(content).toContain('原金额 / Tổng tiền hàng 40.000 VND');
    expect(content).toContain('折扣优惠 / Giảm giá -5.000 VND');
    expect(content).toContain('抹零 / Làm tròn -1.000 VND');
    expect(content).toContain('最终应收 / Phải thu 34.000 VND');
  });

  it('hides TABLE_BILL zero discount and rounding rows without hiding received amount', () => {
    const content = renderedContent(renderPrintDocumentV2({
      receipt: tableBillReceipt({
        subtotal: 40_000,
        originalAmount: 40_000,
        commercialDiscountAmount: 0,
        roundingAmount: 0,
        receivedAmount: 40_000,
        total: 40_000,
      }),
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    }));

    expect(content).toContain('原金额 / Tổng tiền hàng 40.000 VND');
    expect(content).not.toContain('折扣优惠 / Giảm giá');
    expect(content).not.toContain('抹零 / Làm tròn');
    expect(content).toContain('最终应收 / Phải thu 40.000 VND');
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

  it('renders the final 80mm TABLE_BILL structure with readable bilingual item rows', () => {
    const document = renderTableBillV3('MM80', {}, longTableBillReceipt());
    const content = renderedContent(document);
    const header = document.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Món',
    );
    const item = document.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text.includes('招牌酸菜鱼'),
    );

    expect(document.schemaVersion).toBe(3);
    expect(content).toContain('花悦餐厅\nNhà hàng Hoa Việt');
    expect(content).toContain('真实地址 / 0900000000');
    expect(document.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'TEXT', text: '花悦餐厅', overflow: 'FIT' }),
      expect.objectContaining({ type: 'TEXT', text: 'Nhà hàng Hoa Việt', overflow: 'FIT' }),
      expect.objectContaining({ type: 'TEXT', text: '真实地址 / 0900000000' }),
    ]));
    const contact = document.blocks.find(
      (block) => block.type === 'TEXT' && block.text === '真实地址 / 0900000000',
    );
    expect(contact && 'overflow' in contact ? contact.overflow : undefined).toBeUndefined();
    expect(content).toContain('A01 结账小票 / Hóa đơn thanh toán TS-LAYOUT');
    expect(header).toBeUndefined();
    expect(item).toEqual(expect.objectContaining({
      cells: [
        expect.objectContaining({
          text: 'Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè 招牌酸菜鱼特大份家庭分享装',
          fontSize: 'LARGE',
          overflow: 'FIT',
          bold: false,
        }),
        expect.objectContaining({ text: 'x1', fontSize: 'NORMAL', overflow: 'FIT' }),
        expect.objectContaining({ text: '12.345.678', fontSize: 'NORMAL', overflow: 'FIT' }),
      ],
    }));
    const itemIndex = document.blocks.indexOf(item!);
    expect(document.blocks[itemIndex + 1]).toEqual(expect.objectContaining({
      type: 'TEXT',
      text: expect.stringMatching(/^----/),
    }));
    expect(content).toContain('Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè 招牌酸菜鱼特大份家庭分享装');
    expect(content).not.toMatch(/Món|Đơn giá|(^|\n)SL($|\n)|Thành tiền/);
    expect(content).not.toContain('58.000');
    expect((content.match(/生成 \/ Tạo lúc/g) ?? [])).toHaveLength(1);
    expect(content).toContain('备注 / Ghi chú: 少辣');
  });

  it.each([
    {
      label: 'bilingual names',
      name: '花悦餐厅',
      nameVi: 'Nhà hàng Hoa Việt',
      expected: ['花悦餐厅', 'Nhà hàng Hoa Việt'],
    },
    {
      label: 'a Chinese name only',
      name: '花悦餐厅',
      nameVi: undefined,
      expected: ['花悦餐厅'],
    },
    {
      label: 'a Vietnamese name only',
      name: '',
      nameVi: 'Nhà hàng Hoa Việt',
      expected: ['Nhà hàng Hoa Việt'],
    },
    {
      label: 'long Chinese and Vietnamese names',
      name: '云桥花悦优选越南家庭餐厅旗舰店',
      nameVi: 'Nhà hàng gia đình Hoa Việt tuyển chọn của YunQiao',
      expected: [
        '云桥花悦优选越南家庭餐厅旗舰店',
        'Nhà hàng gia đình Hoa Việt tuyển chọn của YunQiao',
      ],
    },
  ])('keeps $label on separate FIT header lines', ({ name, nameVi, expected }) => {
    const value = longTableBillReceipt();
    const document = renderTableBillV3('MM80', {}, {
      ...value,
      merchant: { ...value.merchant, name, nameVi },
    });
    const headerLines = document.blocks.filter(
      (block) => block.type === 'TEXT' && expected.includes(block.text),
    );

    expect(headerLines).toHaveLength(expected.length);
    expect(headerLines).toEqual(expected.map((text) => expect.objectContaining({
      type: 'TEXT', text, align: 'CENTER', bold: true, fontSize: 'LARGE', overflow: 'FIT',
    })));
    expect(renderedContent(document)).not.toContain(`${name} / ${nameVi ?? ''}`);
  });

  it.each([
    {
      label: 'address and phone',
      address: '65V3-2VQ Tiên Phong, Bắc Giang',
      phone: '0333-6247',
      settings: {},
      expected: '65V3-2VQ Tiên Phong, Bắc Giang / 0333-6247',
    },
    {
      label: 'address only',
      address: '65V3-2VQ Tiên Phong, Bắc Giang',
      phone: '0333-6247',
      settings: { merchantPhone: false },
      expected: '65V3-2VQ Tiên Phong, Bắc Giang',
    },
    {
      label: 'phone only',
      address: '65V3-2VQ Tiên Phong, Bắc Giang',
      phone: '0333-6247',
      settings: { merchantAddress: false },
      expected: '0333-6247',
    },
    {
      label: 'neither contact',
      address: '65V3-2VQ Tiên Phong, Bắc Giang',
      phone: '0333-6247',
      settings: { merchantAddress: false, merchantPhone: false },
      expected: undefined,
    },
  ])('renders $label as one wrapping contact block without an orphan separator', ({
    address, phone, settings, expected,
  }) => {
    const value = longTableBillReceipt();
    const document = renderTableBillV3('MM80', settings, {
      ...value,
      merchant: { ...value.merchant, address, phone },
    });
    const contacts = document.blocks.filter((block) =>
      block.type === 'TEXT' && (block.text.includes(address) || block.text.includes(phone)),
    );

    expect(contacts).toHaveLength(expected ? 1 : 0);
    if (expected) {
      expect(contacts[0]).toEqual(expect.objectContaining({
        type: 'TEXT', text: expected, align: 'CENTER', fontSize: 'SMALL',
      }));
      expect('overflow' in contacts[0]).toBe(false);
      expect(expected.startsWith(' / ') || expected.endsWith(' / ')).toBe(false);
    }
  });

  it('uses independent stable rows for every 80mm TABLE_BILL information value', () => {
    const value = longTableBillReceipt();
    value.tableSession = {
      ...value.tableSession!,
      tableName: 'A01-家庭包间-非常长的桌台名称',
      sessionNo: 'TS-LONG-SESSION-20260824-000001',
      orderNos: [
        'HY-LONG-20260824-000000000001',
        'HY-LONG-20260824-000000000002',
      ],
    };
    const document = renderTableBillV3('MM80', {}, value);
    const infoLabels = [
      '开台 / Mở bàn',
      '结账 / Thanh toán',
      '生成 / Tạo lúc',
      '订单数 / Số đơn',
      '订单号 / Mã đơn',
    ];
    const infoRows = document.blocks.filter(
      (block) => block.type === 'ROW' && infoLabels.includes(block.left),
    );

    expect(infoRows).toHaveLength(infoLabels.length);
    expect(infoRows.map((row) => row.type === 'ROW' ? row.left : '')).toEqual(infoLabels);
    expect(infoRows.at(-1)).toEqual(expect.objectContaining({
      type: 'ROW',
      right: 'HY-LONG-20260824-000000000001, HY-LONG-20260824-000000000002',
    }));
    expect(document.blocks).not.toContainEqual(expect.objectContaining({
      type: 'COLUMNS',
      cells: expect.arrayContaining([expect.objectContaining({ text: '开台 / Mở bàn' })]),
    }));
  });

  it.each(['MM80', 'MM58'] as const)(
    'renders the %s ORDER customer receipt with the independent Preview-aligned schema 3 layout',
    (paperWidth) => {
      const document = renderOrderV3(paperWidth);
      const content = renderedContent(document);
      const boxedTitle = document.blocks.find((block) => block.type === 'BOXED_TITLE');
      const item = document.blocks.find(
        (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Phở bò 牛肉粉',
      );
      const total = document.blocks.find(
        (block) => block.type === 'COLUMNS' && block.cells[0]?.text === '合计 / Tổng cộng',
      );
      const time = document.blocks.find(
        (block) => block.type === 'ROW' && block.left === '时间 / Thời gian',
      );

      expect(document.schemaVersion).toBe(3);
      expect(boxedTitle).toEqual(expect.objectContaining({
        type: 'BOXED_TITLE',
        boxText: 'D10',
        title: '顾客小票 / Hóa đơn khách hàng',
        subtitle: '订单号 / Mã đơn A-1',
        boxWeight: paperWidth === 'MM58' ? 28 : 24,
        fontSize: paperWidth === 'MM58' ? 'SMALL' : 'NORMAL',
      }));
      expect(content).toContain('花悦餐厅');
      expect(content).toContain('Nhà hàng Hoa Việt');
      expect(content).not.toMatch(/真实地址|0900000000|类型 \/ Loại/);
      expect(content).not.toContain('桌台 / Bàn');
      expect(time).toEqual(expect.objectContaining({ right: '16:55' }));
      expect(time && time.type === 'ROW' ? time.right : '').not.toMatch(/[/:]\d{2}[/:]|:\d{2}:\d{2}/);
      expect(item).toEqual(expect.objectContaining({
        type: 'COLUMNS',
        cells: [
          expect.objectContaining({
            text: 'Phở bò 牛肉粉',
            fontSize: paperWidth === 'MM58' ? 'NORMAL' : 'LARGE',
            overflow: 'ELLIPSIS',
            bold: false,
          }),
          expect.objectContaining({ text: 'x1', overflow: 'FIT' }),
          expect.objectContaining({ text: expect.stringMatching(/^40[.,]000$/), overflow: 'FIT' }),
        ],
      }));
      expect(total).toEqual(expect.objectContaining({
        type: 'COLUMNS',
        cells: [
          expect.objectContaining({ text: '合计 / Tổng cộng' }),
          expect.objectContaining({ text: expect.stringMatching(/^40[.,]000 VND$/) }),
        ],
      }));
      expect(content).toContain('备注 / Ghi chú: 整单少辣');
      expect(content).not.toContain('备注 / Ghi chú: 少辣');
      expect(content).not.toMatch(/(^|\n)\d+\. |数量 \/ Số lượng|单价 \/ Đơn giá|金额 \/ Thành tiền/);
      expect(content).not.toMatch(/小计 \/ Tạm tính|服务费 \/ Phí dịch vụ|抹零 \/ Làm tròn|最终应收 \/ Phải thu|生成时间 \/ Tạo lúc/);
      expect(content).toContain('自定义结束语');
      expect(document.blocks.filter((block) => block.type === 'DIVIDER')).toHaveLength(2);
    },
  );

  it('preserves every ORDER schema 3 display switch without restoring legacy fields', () => {
    const tableDisabled = renderOrderV3('MM80', { merchantName: false, tableNumber: false });
    expect(tableDisabled.blocks).not.toContainEqual(expect.objectContaining({ type: 'BOXED_TITLE' }));
    expect(tableDisabled.blocks).toContainEqual(expect.objectContaining({
      type: 'TEXT', text: '顾客小票 / Hóa đơn khách hàng', overflow: 'FIT',
    }));
    expect(renderedContent(tableDisabled)).not.toMatch(/花悦餐厅|Nhà hàng Hoa Việt/);

    const noTableReceipt = receipt({ subtotal: 40_000, total: 40_000 });
    noTableReceipt.order = { ...noTableReceipt.order!, tableName: undefined };
    const noTable = renderOrderV3('MM58', {}, noTableReceipt);
    expect(noTable.blocks).not.toContainEqual(expect.objectContaining({ type: 'BOXED_TITLE' }));

    const noOrderNumber = renderOrderV3('MM80', { orderNumber: false });
    expect(renderedContent(noOrderNumber)).not.toContain('A-1');
    expect(noOrderNumber.blocks).toContainEqual(expect.objectContaining({
      type: 'BOXED_TITLE', boxText: 'D10', subtitle: ' ',
    }));
    expect(renderedContent(noOrderNumber)).not.toContain('类型 / Loại');

    const noTime = renderOrderV3('MM80', { orderTime: false });
    expect(renderedContent(noTime)).not.toMatch(/时间 \/ Thời gian|生成时间 \/ Tạo lúc/);
    expect(renderedContent(noTime)).toContain('订单号 / Mã đơn A-1');

    const noPrice = renderOrderV3('MM80', { itemPrice: false });
    const noPriceItem = noPrice.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Phở bò 牛肉粉',
    );
    expect(noPriceItem).toEqual(expect.objectContaining({
      type: 'COLUMNS',
      cells: [
        expect.objectContaining({ text: 'Phở bò 牛肉粉' }),
        expect.objectContaining({ text: 'x1' }),
      ],
    }));
    expect(noPriceItem && noPriceItem.type === 'COLUMNS' ? noPriceItem.cells : []).toHaveLength(2);

    const noNote = renderOrderV3('MM80', { note: false });
    expect(renderedContent(noNote)).not.toMatch(/备注 \/ Ghi chú/);

    const noTotal = renderOrderV3('MM80', { orderTotal: false });
    expect(renderedContent(noTotal)).not.toContain('合计 / Tổng cộng');

    const noFooter = renderOrderV3('MM80', { footer: false });
    expect(renderedContent(noFooter)).not.toMatch(/自定义结束语|Lời cảm ơn tùy chỉnh/);
  });

  it('adds a dashed divider between ORDER customer items', () => {
    const twoItem = receipt({ subtotal: 80_000, total: 80_000 });
    twoItem.items = [
      ...twoItem.items!,
      {
        name: '韭菜炒蛋',
        nameVi: 'Trứng xào hẹ',
        quantity: 2,
        unitPrice: 40_000,
        lineTotal: 80_000,
      },
    ];
    const document = renderPrintDocumentV3({
      receipt: twoItem,
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    });
    const first = document.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Phở bò 牛肉粉',
    );
    const second = document.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Trứng xào hẹ 韭菜炒蛋',
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const firstIndex = document.blocks.indexOf(first!);
    const secondIndex = document.blocks.indexOf(second!);
    expect(document.blocks[firstIndex + 1]).toEqual(expect.objectContaining({
      type: 'TEXT',
      text: expect.stringMatching(/^----/),
    }));
    expect(secondIndex - firstIndex).toBe(2);
  });

  it('renders the final 58mm TABLE_BILL item as one bilingual line with a dashed separator', () => {
    const document = renderTableBillV3('MM58', {}, longTableBillReceipt());
    const content = renderedContent(document);
    const itemIndex = document.blocks.findIndex(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text.includes('招牌酸菜鱼'),
    );
    const item = document.blocks[itemIndex];

    expect(content).toContain('花悦餐厅');
    expect(content).toContain('Nhà hàng Hoa Việt');
    expect(content).toContain('真实地址');
    expect(content).toContain('0900000000');
    expect(item).toEqual(expect.objectContaining({
      type: 'COLUMNS',
      cells: [
        expect.objectContaining({
          text: 'Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè 招牌酸菜鱼特大份家庭分享装',
          fontSize: 'NORMAL',
          overflow: 'FIT',
          bold: false,
        }),
        expect.objectContaining({ text: 'x1', fontSize: 'NORMAL', overflow: 'FIT' }),
        expect.objectContaining({ text: '12.345.678', fontSize: 'NORMAL', overflow: 'FIT' }),
      ],
    }));
    expect(document.blocks[itemIndex + 1]).toEqual(expect.objectContaining({
      type: 'TEXT',
      text: expect.stringMatching(/^----/),
    }));
    expect(content).not.toMatch(/Món|Đơn giá|(^|\n)SL($|\n)|Thành tiền/);
    expect(content).toContain('备注 / Ghi chú: 少辣');
  });

  it.each(['MM80', 'MM58'] as const)(
    'keeps TABLE_BILL quantities while hiding line amounts at %s when itemPrice is false',
    (paperWidth) => {
      const document = renderTableBillV3(paperWidth, { itemPrice: false }, longTableBillReceipt());
      const item = document.blocks.find(
        (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Rau lang xào tỏi thơm ngon kiểu quê nhà 红薯叶',
      );

      expect(item).toEqual(expect.objectContaining({
        type: 'COLUMNS',
        cells: [
          expect.objectContaining({
            text: 'Rau lang xào tỏi thơm ngon kiểu quê nhà 红薯叶',
            overflow: 'FIT',
            bold: false,
          }),
          expect.objectContaining({ text: 'x2', overflow: 'FIT' }),
        ],
      }));
      expect(item && item.type === 'COLUMNS' ? item.cells : []).toHaveLength(2);
      expect(document.blocks).not.toContainEqual(expect.objectContaining({
        type: 'COLUMNS', cells: expect.arrayContaining([expect.objectContaining({ text: '116.000' })]),
      }));
    },
  );

  it.each(['MM80', 'MM58'] as const)(
    'keeps %s TABLE_BILL section dividers without item-to-item or final-to-footer lines',
    (paperWidth) => {
      const document = renderTableBillV3(paperWidth, {}, longTableBillReceipt());
      const blocks = document.blocks;
      const itemIndexes = ['牛肉粉', '招牌酸菜鱼', '红薯叶'].map((name) =>
        blocks.findIndex((block) =>
          block.type === 'COLUMNS' && block.cells[0]?.text.includes(name),
        ));
      const originalIndex = blocks.findIndex(
        (block) => block.type === 'ROW' && block.left === '原金额 / Tổng tiền hàng',
      );
      const finalIndex = blocks.findIndex(
        (block) => block.type === 'ROW' && block.left === '最终应收 / Phải thu',
      );
      const footerIndex = blocks.findIndex(
        (block) => block.type === 'TEXT' && block.text === '自定义结束语',
      );

      expect(itemIndexes.every((index) => index >= 0)).toBe(true);
      expect(blocks[itemIndexes[0] - 1]).toEqual({ type: 'DIVIDER' });
      expect(blocks.slice(itemIndexes[0] + 1, itemIndexes[1])).not.toContainEqual({ type: 'DIVIDER' });
      expect(blocks.slice(itemIndexes[1] + 1, itemIndexes[2])).not.toContainEqual({ type: 'DIVIDER' });
      expect(blocks.slice(itemIndexes[2] + 1, originalIndex)).toContainEqual({ type: 'DIVIDER' });
      expect(blocks.slice(originalIndex + 1, finalIndex)).toContainEqual({ type: 'DIVIDER' });
      expect(blocks.slice(finalIndex + 1, footerIndex)).not.toContainEqual({ type: 'DIVIDER' });
    },
  );

  it('keeps TABLE_BILL schema 3 display flags and legacy contacts authoritative', () => {
    const legacy = renderedContent(renderTableBillV3('MM80', {
      merchantAddress: undefined,
      merchantPhone: undefined,
    }));
    expect(legacy).toContain('真实地址 / 0900000000');

    const hidden = renderTableBillV3('MM80', {
      merchantName: false,
      merchantAddress: false,
      merchantPhone: false,
      tableNumber: false,
      orderNumber: false,
      orderTime: false,
      itemPrice: false,
      orderTotal: false,
      footer: false,
    });
    const hiddenContent = renderedContent(hidden);
    const header = hidden.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Món',
    );
    const item = hidden.blocks.find(
      (block) => block.type === 'COLUMNS' && block.cells[0]?.text === 'Phở bò 牛肉粉',
    );

    expect(hiddenContent).not.toMatch(/花悦餐厅|Nhà hàng Hoa Việt|真实地址|0900000000|A01|订单数|订单号|开台|结账 \/ Thanh toán|生成 \/ Tạo lúc/);
    expect(hiddenContent).toContain('结账小票 / Hóa đơn thanh toán');
    expect(hiddenContent).toContain('TS-LAYOUT');
    expect(hidden.blocks).toContainEqual(expect.objectContaining({
      type: 'TEXT', text: '结账小票 / Hóa đơn thanh toán', overflow: 'FIT',
    }));
    expect(header).toBeUndefined();
    expect(item).toEqual(expect.objectContaining({ cells: [
      expect.objectContaining({ text: 'Phở bò 牛肉粉' }), expect.objectContaining({ text: 'x1' }),
    ] }));
    expect((item as Extract<PrintDocumentV3['blocks'][number], { type: 'COLUMNS' }>).cells).toHaveLength(2);
    expect(hiddenContent).toContain('备注 / Ghi chú: 少辣');
    expect(hiddenContent).not.toMatch(/Món|Đơn giá|SL|Thành tiền|98[.,]000/);
    expect(hiddenContent).not.toMatch(/原金额|折扣 \/ Giảm giá|抹零|最终应收|自定义结束语/);
  });

  it('renders original conditional totals and received amount without recalculation in schema 3', () => {
    const withAdjustments = renderedContent(renderTableBillV3('MM80', {}, tableBillReceipt({
      subtotal: 40_000,
      originalAmount: 40_000,
      commercialDiscountAmount: 5_000,
      roundingAmount: 1_000,
      receivedAmount: 34_000,
      total: 1,
    })));
    expect(withAdjustments).toContain('原金额 / Tổng tiền hàng 40.000 VND');
    expect(withAdjustments).toContain('折扣 / Giảm giá -5.000 VND');
    expect(withAdjustments).toContain('抹零 / Làm tròn -1.000 VND');
    expect(withAdjustments).toContain('最终应收 / Phải thu 34.000 VND');
    expect(withAdjustments).not.toContain('1 VND');

    const withoutAdjustments = renderedContent(renderTableBillV3('MM80', {}, tableBillReceipt({
      subtotal: 40_000,
      originalAmount: 40_000,
      commercialDiscountAmount: 0,
      roundingAmount: 0,
      receivedAmount: 40_000,
      total: 40_000,
    })));
    expect(withoutAdjustments).not.toMatch(/折扣 \/ Giảm giá|抹零 \/ Làm tròn/);
  });

  it('omits close time when absent and keeps generated time only in the upper section', () => {
    const value = longTableBillReceipt();
    value.tableSession = { ...value.tableSession!, closedAt: undefined };
    const content = renderedContent(renderTableBillV3('MM58', {}, value));

    expect(content).not.toContain('结账 / Thanh toán');
    expect((content.match(/生成 \/ Tạo lúc/g) ?? [])).toHaveLength(1);
  });

  it('allows ORDER schema 3 only in customer rendering contexts', () => {
    expect(() => renderPrintDocumentV3({
      receipt: receipt({ subtotal: 40_000, total: 40_000 }),
      paperWidth: 'MM80', purpose: 'FRONT_DESK',
    })).not.toThrow();
    expect(() => renderPrintDocumentV3({
      receipt: tableBillReceipt(), paperWidth: 'MM58', purpose: 'KITCHEN',
    })).toThrow('scoped to customer receipts');
    expect(() => renderPrintDocumentV3({
      receipt: receipt({ subtotal: 40_000, total: 40_000 }),
      paperWidth: 'MM58', purpose: 'KITCHEN',
    })).toThrow('scoped to customer receipts');
    expect(() => renderPrintDocumentV3({
      receipt: tableBillReceipt(), paperWidth: 'MM58', purpose: 'KITCHEN', renderMode: 'CUSTOMER',
    })).not.toThrow();
    expect(() => renderPrintDocumentV3({
      receipt: receipt({ subtotal: 40_000, total: 40_000 }),
      paperWidth: 'MM58', purpose: 'KITCHEN', renderMode: 'CUSTOMER',
    })).not.toThrow();
    expect(renderPrintDocumentV2({
      receipt: receipt({ subtotal: 40_000, total: 40_000 }),
      paperWidth: 'MM58', purpose: 'KITCHEN', renderMode: 'CUSTOMER',
    }).schemaVersion).toBe(2);
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
      id: '11', name: '花悦餐厅', nameVi: 'Nhà hàng Hoa Việt', address: '真实地址', phone: '0900000000',
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

function renderTableBillV3(
  paperWidth: 'MM58' | 'MM80',
  overrides: Partial<ReceiptTemplateDisplaySettings>,
  value: ReceiptDocument = longTableBillReceipt(),
) {
  return renderPrintDocumentV3({
    receipt: value,
    paperWidth,
    purpose: 'FRONT_DESK',
    display: display(overrides),
  });
}

function renderOrderV3(
  paperWidth: 'MM58' | 'MM80',
  overrides: Partial<ReceiptTemplateDisplaySettings> = {},
  value: ReceiptDocument = receipt({
    subtotal: 40_000,
    serviceFee: 2_000,
    roundingAmount: 2_000,
    total: 40_000,
  }),
) {
  return renderPrintDocumentV3({
    receipt: value,
    paperWidth,
    purpose: 'FRONT_DESK',
    display: display(overrides),
  });
}

function longTableBillReceipt(): ReceiptDocument {
  const document = tableBillReceipt({
    subtotal: 12_559_678,
    originalAmount: 12_559_678,
    commercialDiscountAmount: 1_255_967,
    roundingAmount: 711,
    receivedAmount: 11_303_000,
    total: 11_303_000,
  });
  return {
    ...document,
    generatedAt: '2026-08-08T10:22:00.000Z',
    tableSession: {
      id: '31', sessionNo: 'TS-LAYOUT', tableName: 'A01',
      openedAt: '2026-08-08T10:21:00.000Z', closedAt: '2026-08-08T10:22:00.000Z',
      orderNos: ['20260808001', '20260808002'],
    },
    items: [
      { name: '牛肉粉', nameVi: 'Phở bò', quantity: 1, unitPrice: 98_000, lineTotal: 98_000, note: '少辣' },
      {
        name: '招牌酸菜鱼特大份家庭分享装',
        nameVi: 'Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè',
        quantity: 1,
        unitPrice: 12_345_678,
        lineTotal: 12_345_678,
      },
      {
        name: '红薯叶',
        nameVi: 'Rau lang xào tỏi thơm ngon kiểu quê nhà',
        quantity: 2,
        unitPrice: 58_000,
        lineTotal: 116_000,
      },
    ],
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

function renderedContent(document: PrintDocument) {
  return document.blocks.flatMap((block) => {
    if (block.type === 'TEXT') return [block.text];
    if (block.type === 'ROW') return [`${block.left} ${block.right}`];
    if (block.type === 'COLUMNS') return [block.cells.map((cell) => cell.text).join(' ')];
    if (block.type === 'BOXED_TITLE') return [`${block.boxText} ${block.title} ${block.subtitle}`];
    return [];
  }).join('\n');
}
