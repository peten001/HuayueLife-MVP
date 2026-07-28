import {
  assertReceiptDocument,
  ReceiptDocument,
} from '../types/receipt-document';
import {
  DEFAULT_RECEIPT_FOOTER_VI,
  DEFAULT_RECEIPT_FOOTER_ZH,
} from '../types/bilingual-receipt';
import { CloudProvider } from './cloud-printing.service';

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

/**
 * The cloud text document follows the same immutable bilingual snapshot used
 * by Android. Provider-specific markup is applied only after all data has been
 * escaped, so merchant text cannot inject printer control tags.
 */
export function renderCloudReceipt(
  value: unknown,
  provider: CloudProvider,
) {
  assertReceiptDocument(value);
  const lines = receiptLines(value);
  if (provider === 'FEIE') {
    return lines.map((line, index) => {
      const escaped = escapeFeie(line);
      return index === 0 ? `<CB>${escaped}</CB>` : escaped;
    }).join('<BR>');
  }
  return lines.join('\n');
}

export function receiptLines(document: ReceiptDocument) {
  const lines: string[] = [];
  lines.push(document.merchant.name);
  if (document.merchant.nameVi && document.merchant.nameVi !== document.merchant.name) {
    lines.push(document.merchant.nameVi);
  }
  if (document.merchant.address) lines.push(document.merchant.address);
  if (document.merchant.phone) lines.push(document.merchant.phone);
  lines.push(divider());

  if (document.receiptType === 'ORDER_CUSTOMER') {
    const order = document.order!;
    lines.push('顾客小票 / Hóa đơn khách hàng');
    lines.push(`订单 / Đơn: ${order.orderNo}`);
    if (order.tableName) lines.push(`桌台 / Bàn: ${order.tableName}`);
    lines.push(`类型 / Loại: ${orderType(order.orderType)}`);
    if (order.guestCount !== undefined) {
      lines.push(`人数 / Số khách: ${order.guestCount}`);
    }
    lines.push(`下单时间 / Đặt lúc: ${formatTime(order.createdAt)}`);
  } else {
    const table = document.tableSession!;
    lines.push('结账小票 / Hóa đơn thanh toán');
    lines.push(`桌台 / Bàn: ${table.tableName}`);
    lines.push(`桌账 / Phiên bàn: ${table.sessionNo}`);
    lines.push(`订单数 / Số đơn: ${table.orderNos.length}`);
    if (table.orderNos.length) {
      lines.push(`订单 / Đơn: ${table.orderNos.join(', ')}`);
    }
    lines.push(`开台时间 / Mở bàn: ${formatTime(table.openedAt)}`);
    if (table.closedAt) {
      lines.push(`结账时间 / Thanh toán: ${formatTime(table.closedAt)}`);
    }
  }

  lines.push(divider());
  document.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}`);
    if (item.nameVi && item.nameVi !== item.name) lines.push(`   ${item.nameVi}`);
    if (item.specification) {
      lines.push(`   规格 / Quy cách: ${item.specification}`);
    }
    lines.push(`   数量 / Số lượng: ${item.quantity}`);
    lines.push(`   单价 / Đơn giá: ${money(item.unitPrice)}`);
    lines.push(`   金额 / Thành tiền: ${money(item.lineTotal)}`);
    if (item.note) lines.push(`   备注 / Ghi chú: ${item.note}`);
  });

  lines.push(divider());
  lines.push(`小计 / Tạm tính: ${money(document.totals.subtotal)}`);
  if (document.totals.discount !== undefined) {
    lines.push(`优惠 / Giảm giá: ${money(document.totals.discount)}`);
  }
  if (document.totals.serviceFee !== undefined) {
    lines.push(`服务费 / Phí dịch vụ: ${money(document.totals.serviceFee)}`);
  }
  if (document.totals.originalAmount !== undefined) {
    lines.push(`原金额 / Tổng tiền ban đầu: ${money(document.totals.originalAmount)}`);
  }
  if ((document.totals.roundingAmount ?? 0) > 0) {
    lines.push(`抹零 / Làm tròn: ${money(document.totals.roundingAmount!)}`);
  }
  if (document.totals.receivedAmount !== undefined) {
    lines.push(`实收 / Thực thu: ${money(document.totals.receivedAmount)}`);
  } else {
    lines.push(`合计 / Tổng cộng: ${money(document.totals.total)}`);
  }
  if (document.note) lines.push(`订单备注 / Ghi chú: ${document.note}`);

  lines.push(divider());
  lines.push(`生成时间 / Tạo lúc: ${formatTime(document.generatedAt)}`);
  lines.push(divider());
  lines.push(document.footer?.zh || DEFAULT_RECEIPT_FOOTER_ZH);
  lines.push(document.footer?.vi || DEFAULT_RECEIPT_FOOTER_VI);
  return lines;
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

function divider() {
  return '--------------------------------';
}

function escapeFeie(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
