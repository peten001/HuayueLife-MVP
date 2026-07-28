export const DEFAULT_RECEIPT_FOOTER_ZH = '谢谢惠顾，欢迎再次光临';
export const DEFAULT_RECEIPT_FOOTER_VI = 'Cảm ơn quý khách, hẹn gặp lại!';

export const BILINGUAL_RECEIPT_LABELS = {
  customerReceipt: '顾客小票 / Hóa đơn khách hàng',
  orderNumber: '订单号 / Mã đơn',
  table: '桌台 / Bàn',
  time: '时间 / Thời gian',
  quantity: '数量 / Số lượng',
  unitPrice: '单价 / Đơn giá',
  amount: '金额 / Thành tiền',
  total: '合计 / Tổng cộng',
  note: '备注 / Ghi chú',
};

export interface BilingualReceiptFooter {
  zh: string;
  vi: string;
}

export function splitBilingualFooter(value: unknown): BilingualReceiptFooter {
  if (typeof value !== 'string') return { zh: DEFAULT_RECEIPT_FOOTER_ZH, vi: DEFAULT_RECEIPT_FOOTER_VI };
  const lines = value.split('\\n').join('\n').split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
  return {
    zh: lines[0] || DEFAULT_RECEIPT_FOOTER_ZH,
    vi: lines[1] || DEFAULT_RECEIPT_FOOTER_VI,
  };
}

export function joinBilingualFooter(value: Partial<BilingualReceiptFooter>): string {
  return [value.zh?.trim() || DEFAULT_RECEIPT_FOOTER_ZH, value.vi?.trim() || DEFAULT_RECEIPT_FOOTER_VI].join('\n');
}
