import { PrinterPurpose, PrintingPaperWidth } from '@prisma/client';
import {
  assertPrintDocumentV2,
  PrintBlock,
  PrintDocumentV2,
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
  if (document.merchant.address) merchantBlocks.push(text(document.merchant.address, 'CENTER'));
  if (document.merchant.phone) merchantBlocks.push(text(document.merchant.phone, 'CENTER'));
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
    summaryBlocks.push(row('小计 / Tạm tính', money(document.totals.subtotal)));
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
