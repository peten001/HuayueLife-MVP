import { PrinterPurpose, PrintingPaperWidth } from '@prisma/client';
import {
  assertPrintDocumentV3,
  assertPrintDocumentV2,
  ColumnsPrintBlock,
  PrintBlock,
  PrintBlockV3,
  PrintColumnCell,
  PrintDocumentV2,
  PrintDocumentV3,
} from '../types/print-document';
import {
  DEFAULT_RECEIPT_FOOTER_VI,
  DEFAULT_RECEIPT_FOOTER_ZH,
} from '../types/bilingual-receipt';
import {
  DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
  ReceiptDocument,
  ReceiptTemplateDisplaySettings,
} from '../types/receipt-document';

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const LOCAL_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const LOCAL_BILL_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const LOCAL_BILL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function renderPrintDocumentV2(input: {
  receipt: ReceiptDocument;
  paperWidth: PrintingPaperWidth;
  purpose: PrinterPurpose;
  display?: ReceiptTemplateDisplaySettings;
  renderMode?: 'CUSTOMER' | 'KITCHEN';
}): PrintDocumentV2 {
  const renderMode = input.renderMode
    ?? (input.purpose === 'KITCHEN' ? 'KITCHEN' : 'CUSTOMER');
  const blocks = renderMode === 'KITCHEN'
    ? kitchenBlocks(input.receipt)
    : customerBlocks(
        input.receipt,
        input.display ?? DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
      );
  return createPrintDocumentV2(input.paperWidth, blocks);
}

export function createPrintDocumentV2(
  paperWidth: PrintingPaperWidth,
  blocks: PrintBlock[],
): PrintDocumentV2 {
  const document: PrintDocumentV2 = {
    documentType: 'PRINT_DOCUMENT',
    schemaVersion: 2,
    paperWidth,
    copies: 1,
    blocks: [...blocks, { type: 'FEED', lines: 3 }, { type: 'CUT', mode: 'HALF' }],
  };
  assertPrintDocumentV2(document);
  return document;
}

export function renderPrintDocumentV3(input: {
  receipt: ReceiptDocument;
  paperWidth: PrintingPaperWidth;
  purpose: PrinterPurpose;
  display?: ReceiptTemplateDisplaySettings;
  renderMode?: 'CUSTOMER' | 'KITCHEN';
}): PrintDocumentV3 {
  const renderMode = input.renderMode
    ?? (input.purpose === 'KITCHEN' ? 'KITCHEN' : 'CUSTOMER');
  if (
    (input.receipt.receiptType !== 'TABLE_BILL' &&
      input.receipt.receiptType !== 'ORDER_CUSTOMER') ||
    renderMode !== 'CUSTOMER'
  ) {
    throw new Error('PrintDocument V3 layout is scoped to customer receipts');
  }
  return createPrintDocumentV3(
    input.paperWidth,
    input.receipt.receiptType === 'TABLE_BILL'
      ? tableBillBlocksV3(
          input.receipt,
          input.paperWidth,
          input.display ?? DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
        )
      : orderCustomerBlocksV3(
          input.receipt,
          input.paperWidth,
          input.display ?? DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
        ),
  );
}

export function createPrintDocumentV3(
  paperWidth: PrintingPaperWidth,
  blocks: PrintBlockV3[],
): PrintDocumentV3 {
  const document: PrintDocumentV3 = {
    documentType: 'PRINT_DOCUMENT',
    schemaVersion: 3,
    paperWidth,
    copies: 1,
    blocks: [...blocks, { type: 'FEED', lines: 3 }, { type: 'CUT', mode: 'HALF' }],
  };
  assertPrintDocumentV3(document);
  return document;
}

function orderCustomerBlocksV3(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const blocks: PrintBlockV3[] = [];
  appendSectionV3(blocks, orderCustomerHeaderBlocksV3(document, paperWidth, display));
  appendSectionV3(blocks, orderCustomerItemBlocksV3(document, paperWidth, display));
  appendSectionV3(blocks, orderCustomerTotalBlocksV3(document, paperWidth, display));
  if (display.footer) {
    const footer = document.footer ?? {
      zh: DEFAULT_RECEIPT_FOOTER_ZH,
      vi: DEFAULT_RECEIPT_FOOTER_VI,
    };
    if (footer.zh) blocks.push(textV3(footer.zh, 'CENTER'));
    if (footer.vi) blocks.push(textV3(footer.vi, 'CENTER'));
  }
  return blocks;
}

function orderCustomerHeaderBlocksV3(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const order = document.order!;
  const title = '顾客小票 / Hóa đơn khách hàng';
  const tableName = order.orderType === 'DINE_IN' ? optionalText(order.tableName) : undefined;
  const showTableBox = display.tableNumber !== false && Boolean(tableName);
  const blocks: PrintBlockV3[] = [];

  if (display.merchantName !== false) {
    const nameZh = optionalText(document.merchant.name);
    const nameVi = distinctOptionalText(document.merchant.nameVi, nameZh);
    if (nameZh) blocks.push(textV3(nameZh, 'CENTER', true, 'LARGE', 'FIT'));
    if (nameVi) blocks.push(textV3(nameVi, 'CENTER', false, 'NORMAL', 'FIT'));
  }

  if (showTableBox) {
    blocks.push({
      type: 'BOXED_TITLE',
      boxText: tableName!,
      title,
      subtitle: display.orderNumber !== false
        ? `订单号 / Mã đơn ${order.orderNo}`
        : ' ',
      boxWeight: paperWidth === 'MM58' ? 28 : 24,
      gapDots: paperWidth === 'MM58' ? 6 : 10,
      fontSize: paperWidth === 'MM58' ? 'SMALL' : 'NORMAL',
    });
  } else {
    blocks.push(textV3(
      title,
      'CENTER',
      true,
      paperWidth === 'MM58' ? 'SMALL' : 'NORMAL',
      'FIT',
    ));
    if (display.orderNumber !== false) {
      blocks.push(textV3(
        `订单号 / Mã đơn ${order.orderNo}`,
        'CENTER',
        true,
        'SMALL',
        'FIT',
      ));
    }
  }
  if (display.orderTime !== false) {
    blocks.push(rowV3('时间 / Thời gian', formatBillTime(order.createdAt)));
  }
  return blocks;
}

function orderCustomerItemBlocksV3(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const blocks: PrintBlockV3[] = [];
  const showAmount = display.itemPrice !== false;
  const gap = paperWidth === 'MM58' ? 3 : 6;
  const weights = showAmount
    ? (paperWidth === 'MM58' ? [58, 12, 30] : [72, 10, 18])
    : (paperWidth === 'MM58' ? [82, 18] : [88, 12]);

  for (const item of document.items) {
    const name = optionalText(item.name) ?? item.name;
    blocks.push(columnsV3(gap, showAmount
      ? [
          columnV3(name, weights[0], 'LEFT', true, 'NORMAL', 'ELLIPSIS'),
          columnV3(`x${item.quantity}`, weights[1], 'CENTER', true, 'NORMAL', 'FIT'),
          columnV3(compactMoney(item.lineTotal), weights[2], 'RIGHT', true, 'NORMAL', 'FIT'),
        ]
      : [
          columnV3(name, weights[0], 'LEFT', true, 'NORMAL', 'ELLIPSIS'),
          columnV3(`x${item.quantity}`, weights[1], 'RIGHT', true, 'NORMAL', 'FIT'),
        ]));
    const nameVi = distinctOptionalText(item.nameVi, name);
    if (nameVi) blocks.push(textV3(nameVi));
  }

  const orderNote = display.note !== false ? optionalText(document.note) : undefined;
  if (orderNote) blocks.push(textV3(`备注 / Ghi chú: ${orderNote}`));
  return blocks;
}

function orderCustomerTotalBlocksV3(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  if (display.orderTotal === false) return [];
  return [columnsV3(paperWidth === 'MM58' ? 3 : 6, [
    columnV3('合计 / Tổng cộng', 68, 'LEFT', true, 'NORMAL', 'ELLIPSIS'),
    columnV3(money(document.totals.total), 32, 'RIGHT', true, 'NORMAL', 'FIT'),
  ])];
}

function tableBillBlocksV3(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const blocks: PrintBlockV3[] = [];
  appendSectionV3(blocks, tableBillMerchantBlocks(document, paperWidth, display));
  appendSectionV3(blocks, tableBillInformationBlocks(document, paperWidth, display));
  appendSectionV3(blocks, tableBillItemBlocks(document, paperWidth, display));
  appendSectionV3(blocks, tableBillTotalBlocks(document, display));
  if (display.footer) {
    const footer = document.footer ?? {
      zh: DEFAULT_RECEIPT_FOOTER_ZH,
      vi: DEFAULT_RECEIPT_FOOTER_VI,
    };
    blocks.push(...[
      ...(footer.zh ? [textV3(footer.zh, 'CENTER')] : []),
      ...(footer.vi ? [textV3(footer.vi, 'CENTER')] : []),
    ]);
  }
  return blocks;
}

function tableBillMerchantBlocks(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const blocks: PrintBlockV3[] = [];
  const nameZh = optionalText(document.merchant.name);
  const nameVi = distinctOptionalText(document.merchant.nameVi, nameZh);
  const address = display.merchantAddress === false
    ? undefined
    : optionalText(document.merchant.address);
  const phone = display.merchantPhone === false
    ? undefined
    : optionalText(document.merchant.phone);
  if (display.merchantName) {
    if (paperWidth === 'MM80') {
      const combinedName = slashJoin(nameZh, nameVi);
      if (combinedName) blocks.push(textV3(combinedName, 'CENTER', true, 'LARGE', 'FIT'));
    } else {
      if (nameZh) blocks.push(textV3(nameZh, 'CENTER', true, 'LARGE'));
      if (nameVi) blocks.push(textV3(nameVi, 'CENTER', true));
    }
  }
  if (paperWidth === 'MM80') {
    const contact = slashJoin(address, phone);
    if (contact) blocks.push(textV3(contact, 'CENTER', false, 'SMALL', 'FIT'));
  } else {
    if (address) blocks.push(textV3(address, 'CENTER', false, 'SMALL'));
    if (phone) blocks.push(textV3(phone, 'CENTER', false, 'SMALL'));
  }
  return blocks;
}

function tableBillInformationBlocks(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const table = document.tableSession!;
  const blocks: PrintBlockV3[] = [];
  const title = '结账小票/Hóa đơn thanh toán';
  if (display.tableNumber) {
    blocks.push({
      type: 'BOXED_TITLE',
      boxText: table.tableName,
      title,
      subtitle: table.sessionNo,
      boxWeight: paperWidth === 'MM58' ? 28 : 24,
      gapDots: paperWidth === 'MM58' ? 6 : 10,
      fontSize: paperWidth === 'MM58' ? 'SMALL' : 'NORMAL',
    });
  } else {
    blocks.push(textV3(
      title,
      'CENTER',
      true,
      paperWidth === 'MM58' ? 'SMALL' : 'NORMAL',
      'FIT',
    ));
    blocks.push(textV3(table.sessionNo, 'CENTER', true, 'SMALL'));
  }

  if (paperWidth === 'MM80') {
    blocks.push(...tableBillInformationBlocks80(document, display));
  } else {
    if (display.orderTime) {
      blocks.push(rowV3(
        '开台 / Mở bàn',
        formatBillDateTime(table.openedAt ?? document.generatedAt),
      ));
      if (table.closedAt) {
        blocks.push(rowV3('结账 / Thanh toán', formatBillTime(table.closedAt)));
      }
      blocks.push(rowV3('生成 / Tạo lúc', formatBillTime(document.generatedAt)));
    }
    if (display.orderNumber) {
      blocks.push(rowV3('订单数 / Số đơn', String(table.orderNos.length)));
      if (table.orderNos.length) {
        blocks.push(rowV3('订单号 / Mã đơn', table.orderNos.join(', ')));
      }
    }
  }
  return blocks;
}

function tableBillInformationBlocks80(
  document: ReceiptDocument,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const table = document.tableSession!;
  const blocks: PrintBlockV3[] = [];
  const gap = 8;
  if (display.orderTime) {
    if (table.closedAt) {
      blocks.push(columnsV3(gap, [
        columnV3('开台 / Mở bàn', 19, 'LEFT', true, 'SMALL', 'FIT'),
        columnV3(formatBillDateTime(table.openedAt ?? document.generatedAt), 31, 'RIGHT', false, 'SMALL', 'FIT'),
        columnV3('结账 / Thanh toán', 30, 'LEFT', true, 'SMALL', 'FIT'),
        columnV3(formatBillTime(table.closedAt), 20, 'RIGHT', false, 'SMALL', 'FIT'),
      ]));
    } else {
      blocks.push(columnsV3(gap, [
        columnV3('开台 / Mở bàn', 28, 'LEFT', true, 'SMALL', 'FIT'),
        columnV3(formatBillDateTime(table.openedAt ?? document.generatedAt), 72, 'RIGHT', false, 'SMALL', 'FIT'),
      ]));
    }
  }
  if (display.orderNumber && display.orderTime) {
    blocks.push(columnsV3(gap, [
      columnV3('订单数 / Số đơn', 25, 'LEFT', true, 'SMALL', 'FIT'),
      columnV3(String(table.orderNos.length), 15, 'RIGHT', false, 'SMALL', 'FIT'),
      columnV3('生成 / Tạo lúc', 38, 'LEFT', true, 'SMALL', 'FIT'),
      columnV3(formatBillTime(document.generatedAt), 22, 'RIGHT', false, 'SMALL', 'FIT'),
    ]));
  } else if (display.orderNumber) {
    blocks.push(rowV3('订单数 / Số đơn', String(table.orderNos.length)));
  } else if (display.orderTime) {
    blocks.push(rowV3('生成 / Tạo lúc', formatBillTime(document.generatedAt)));
  }
  if (display.orderNumber && table.orderNos.length) {
    blocks.push(rowV3('订单号 / Mã đơn', table.orderNos.join(', ')));
  }
  return blocks;
}

function tableBillItemBlocks(
  document: ReceiptDocument,
  paperWidth: PrintingPaperWidth,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  const blocks: PrintBlockV3[] = [];
  const showAmount = display.itemPrice !== false;
  const gap = paperWidth === 'MM58' ? 3 : 6;
  const weights = showAmount
    ? (paperWidth === 'MM58' ? [58, 12, 30] : [72, 10, 18])
    : (paperWidth === 'MM58' ? [82, 18] : [88, 12]);

  for (const item of document.items) {
    const name = optionalText(item.name) ?? item.name;
    const nameVi = distinctOptionalText(item.nameVi, name);
    blocks.push(columnsV3(gap, showAmount
      ? [
          columnV3(name, weights[0], 'LEFT', true, 'NORMAL', 'ELLIPSIS'),
          columnV3(`x${item.quantity}`, weights[1], 'CENTER', true, 'NORMAL', 'FIT'),
          columnV3(compactMoney(item.lineTotal), weights[2], 'RIGHT', true, 'NORMAL', 'FIT'),
        ]
      : [
          columnV3(name, weights[0], 'LEFT', true, 'NORMAL', 'ELLIPSIS'),
          columnV3(`x${item.quantity}`, weights[1], 'RIGHT', true, 'NORMAL', 'FIT'),
        ]));
    if (nameVi) blocks.push(textV3(nameVi));
    const note = optionalText(item.note);
    if (note) {
      blocks.push(textV3(`备注 / Ghi chú: ${note}`, 'LEFT', false, 'SMALL'));
    }
  }
  return blocks;
}

function tableBillTotalBlocks(
  document: ReceiptDocument,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlockV3[] {
  if (!display.orderTotal) return [];
  const blocks: PrintBlockV3[] = [
    rowV3(
      '原金额 / Tổng tiền hàng',
      money(document.totals.originalAmount ?? document.totals.subtotal),
    ),
  ];
  if ((document.totals.commercialDiscountAmount ?? 0) > 0) {
    blocks.push(rowV3(
      '折扣 / Giảm giá',
      `-${money(document.totals.commercialDiscountAmount!)}`,
    ));
  }
  const rounding = document.totals.roundingAmount ?? document.totals.discount ?? 0;
  if (rounding > 0) blocks.push(rowV3('抹零 / Làm tròn', `-${money(rounding)}`));
  blocks.push({ type: 'DIVIDER' });
  blocks.push(rowV3(
    '最终应收 / Phải thu',
    money(document.totals.receivedAmount ?? document.totals.total),
    true,
  ));
  return blocks;
}

function columnV3(
  value: string,
  weight: number,
  align: PrintColumnCell['align'],
  bold: boolean,
  fontSize: PrintColumnCell['fontSize'],
  overflow: PrintColumnCell['overflow'],
): PrintColumnCell {
  return {
    text: value,
    weight,
    align,
    bold,
    fontSize,
    overflow,
    paddingDots: 0,
  };
}

function columnsV3(gapDots: number, cells: PrintColumnCell[]): ColumnsPrintBlock {
  return { type: 'COLUMNS', gapDots, cells };
}

function textV3(
  value: string,
  align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT',
  bold = false,
  fontSize: 'SMALL' | 'NORMAL' | 'LARGE' = 'NORMAL',
  overflow?: PrintColumnCell['overflow'],
): PrintBlockV3 {
  return {
    type: 'TEXT', text: value, align, bold, fontSize, underline: false,
    ...(overflow ? { overflow } : {}),
  };
}

function rowV3(left: string, right: string, bold = false): PrintBlockV3 {
  return { type: 'ROW', left, right, bold };
}

function appendSectionV3(blocks: PrintBlockV3[], section: PrintBlockV3[]) {
  if (section.length === 0) return;
  if (blocks.length > 0) blocks.push({ type: 'DIVIDER' });
  blocks.push(...section);
}

function optionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function distinctOptionalText(value: string | undefined, other: string | undefined) {
  const normalized = optionalText(value);
  return normalized && normalized !== other ? normalized : undefined;
}

function slashJoin(...values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join(' / ');
}

function compactMoney(value: number) {
  return VND.format(value);
}

function formatBillDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 32)
    : LOCAL_BILL_DATE_TIME.format(date).replace(', ', ' ');
}

function formatBillTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 32) : LOCAL_BILL_TIME.format(date);
}

function customerBlocks(
  document: ReceiptDocument,
  display: Readonly<ReceiptTemplateDisplaySettings>,
): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  const merchantBlocks: PrintBlock[] = [];
  if (display.merchantName) {
    merchantBlocks.push(text(document.merchant.name, 'CENTER', true, 'LARGE'));
    if (document.merchant.nameVi && document.merchant.nameVi !== document.merchant.name) {
      merchantBlocks.push(text(document.merchant.nameVi, 'CENTER'));
    }
  }
  const isTableBill = document.receiptType === 'TABLE_BILL';
  if (document.merchant.address && (!isTableBill || display.merchantAddress !== false)) {
    merchantBlocks.push(text(document.merchant.address, 'CENTER'));
  }
  if (document.merchant.phone && (!isTableBill || display.merchantPhone !== false)) {
    merchantBlocks.push(text(document.merchant.phone, 'CENTER'));
  }
  appendSection(blocks, merchantBlocks);

  const orderBlocks: PrintBlock[] = [];
  if (document.receiptType === 'ORDER_CUSTOMER') {
    const order = document.order!;
    orderBlocks.push(text('顾客小票 / Hóa đơn khách hàng', 'CENTER', true));
    if (display.orderNumber) orderBlocks.push(row('订单 / Đơn', order.orderNo, true));
    if (display.tableNumber && order.tableName) orderBlocks.push(row('桌台 / Bàn', order.tableName));
    orderBlocks.push(row('类型 / Loại', orderType(order.orderType)));
    if (order.guestCount !== undefined) {
      orderBlocks.push(row('人数 / Số khách', String(order.guestCount)));
    }
    if (display.orderTime) {
      orderBlocks.push(row('下单时间 / Đặt lúc', formatTime(order.createdAt)));
    }
  } else {
    const table = document.tableSession!;
    const orderNos = table.orderNos ?? [];
    orderBlocks.push(text('结账小票 / Hóa đơn thanh toán', 'CENTER', true));
    if (display.tableNumber) orderBlocks.push(row('桌台 / Bàn', table.tableName, true));
    orderBlocks.push(row('桌账 / Phiên bàn', table.sessionNo));
    if (display.orderNumber) {
      orderBlocks.push(row('订单数 / Số đơn', String(orderNos.length)));
      if (orderNos.length) orderBlocks.push(text(`订单 / Đơn: ${orderNos.join(', ')}`));
    }
    if (display.orderTime) {
      orderBlocks.push(row('开台时间 / Mở bàn', formatTime(table.openedAt ?? document.generatedAt)));
      if (table.closedAt) {
        orderBlocks.push(row('结账时间 / Thanh toán', formatTime(table.closedAt)));
      }
    }
  }
  appendSection(blocks, orderBlocks);

  const itemBlocks: PrintBlock[] = [];
  document.items.forEach((item, index) => {
    itemBlocks.push(text(`${index + 1}. ${item.name}`, 'LEFT', true));
    if (item.nameVi && item.nameVi !== item.name) itemBlocks.push(text(`   ${item.nameVi}`));
    if (item.nameEn && item.nameEn !== item.name && item.nameEn !== item.nameVi) {
      itemBlocks.push(text(`   ${item.nameEn}`));
    }
    if (item.specification) itemBlocks.push(text(`   规格 / Quy cách: ${item.specification}`));
    itemBlocks.push(row('   数量 / Số lượng', String(item.quantity)));
    if (display.itemPrice) {
      itemBlocks.push(row('   单价 / Đơn giá', money(item.unitPrice)));
      itemBlocks.push(row('   金额 / Thành tiền', money(item.lineTotal)));
    }
    if (item.note) itemBlocks.push(text(`   备注 / Ghi chú: ${item.note}`));
  });
  appendSection(blocks, itemBlocks);

  const summaryBlocks: PrintBlock[] = [];
  if (display.orderTotal) {
    if (isTableBill) {
      summaryBlocks.push(row(
        '原金额 / Tổng tiền hàng',
        money(document.totals.originalAmount ?? document.totals.subtotal),
      ));
    } else {
      summaryBlocks.push(row('小计 / Tạm tính', money(document.totals.subtotal)));
    }
    if (
      document.receiptType === 'TABLE_BILL' &&
      (document.totals.commercialDiscountAmount ?? 0) > 0
    ) {
      summaryBlocks.push(row(
        '折扣优惠 / Giảm giá',
        `-${money(document.totals.commercialDiscountAmount!)}`,
      ));
    }
    if (document.totals.serviceFee !== undefined) {
      summaryBlocks.push(row('服务费 / Phí dịch vụ', money(document.totals.serviceFee)));
    }
    // Receipt V1 historically used `discount` as a rounding compatibility alias.
    // Do not reinterpret that legacy field as a commercial discount.
    const rounding = document.totals.roundingAmount ?? document.totals.discount ?? 0;
    if (rounding > 0) summaryBlocks.push(row('抹零 / Làm tròn', `-${money(rounding)}`));
    const finalAmount = document.totals.receivedAmount ?? document.totals.total;
    summaryBlocks.push(row('最终应收 / Phải thu', money(finalAmount), true));
  }
  if (display.note && document.note) {
    summaryBlocks.push(text(`订单备注 / Ghi chú: ${document.note}`));
  }
  appendSection(blocks, summaryBlocks);
  if (document.receiptType === 'ORDER_CUSTOMER' || display.orderTime) {
    appendSection(blocks, [row('生成时间 / Tạo lúc', formatTime(document.generatedAt))]);
  }
  if (display.footer) {
    const footer = document.footer ?? {
      zh: DEFAULT_RECEIPT_FOOTER_ZH,
      vi: DEFAULT_RECEIPT_FOOTER_VI,
    };
    appendSection(blocks, [
      ...(footer.zh ? [text(footer.zh, 'CENTER')] : []),
      ...(footer.vi ? [text(footer.vi, 'CENTER')] : []),
    ]);
  }
  return blocks;
}

function appendSection(blocks: PrintBlock[], section: PrintBlock[]) {
  if (section.length === 0) return;
  if (blocks.length > 0) blocks.push({ type: 'DIVIDER' });
  blocks.push(...section);
}

function kitchenBlocks(document: ReceiptDocument): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  document.items.forEach((item) => {
    blocks.push(text(item.name, 'LEFT', true, 'LARGE'));
    if (item.nameVi && item.nameVi !== item.name) blocks.push(text(item.nameVi));
    blocks.push(row('数量 / Số lượng', String(item.quantity), true));
    if (item.note) blocks.push(text(`备注 / Ghi chú: ${item.note}`, 'LEFT', true));
    blocks.push({ type: 'DIVIDER' });
  });
  return blocks;
}

function text(
  value: string,
  align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT',
  bold = false,
  fontSize: 'SMALL' | 'NORMAL' | 'LARGE' = 'NORMAL',
): PrintBlock {
  return { type: 'TEXT', text: value, align, bold, fontSize, underline: false };
}

function row(left: string, right: string, bold = false): PrintBlock {
  return { type: 'ROW', left, right, bold };
}

function money(value: number) {
  return `${VND.format(value)} VND`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 32) : LOCAL_TIME.format(date);
}

function orderType(value: string) {
  if (value === 'DINE_IN') return '堂食 / Tại bàn';
  if (value === 'PICKUP') return '自取 / Tự đến lấy';
  if (value === 'DELIVERY') return '配送 / Giao hàng';
  return value;
}
