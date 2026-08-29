import type { PaymentMethod } from '@prisma/client';

export const DEFAULT_RECEIPT_FOOTER_ZH = '谢谢惠顾，欢迎再次光临';
export const DEFAULT_RECEIPT_FOOTER_VI = 'Cảm ơn quý khách, hẹn gặp lại!';

export interface BilingualReceiptFooter {
  zh: string;
  vi: string;
}

/**
 * Canonical one-line dish-name format: Vietnamese first, Chinese second,
 * joined by a single space. Missing or duplicate values collapse to one name;
 * never emit separators, undefined, null, or double spaces.
 */
export function formatBilingualDishName(
  nameVi: string | undefined | null,
  nameZh: string | undefined | null,
): string {
  const vi = nameVi?.trim() ?? '';
  const zh = nameZh?.trim() ?? '';
  if (!vi) return zh;
  if (!zh || vi === zh) return vi;
  return `${vi} ${zh}`;
}

export function splitBilingualFooter(value: unknown): BilingualReceiptFooter {
  if (typeof value !== 'string') return defaults();
  const lines = value.split('\\n').join('\n').split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
  return { zh: lines[0] || DEFAULT_RECEIPT_FOOTER_ZH, vi: lines[1] || DEFAULT_RECEIPT_FOOTER_VI };
}

export function footerFromTemplateDefinition(definition: unknown): BilingualReceiptFooter {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return defaults();
  const value = definition as Record<string, unknown>;
  if (typeof value.footerTextZh === 'string' || typeof value.footerTextVi === 'string') {
    return {
      zh: typeof value.footerTextZh === 'string'
        ? value.footerTextZh.trim()
        : DEFAULT_RECEIPT_FOOTER_ZH,
      vi: typeof value.footerTextVi === 'string'
        ? value.footerTextVi.trim()
        : DEFAULT_RECEIPT_FOOTER_VI,
    };
  }
  return splitBilingualFooter(value.footerText);
}

export function formatBilingualPaymentMethod(
  paymentMethod: PaymentMethod | undefined,
): string | undefined {
  if (paymentMethod === 'CASH') return '现金 / Tiền mặt';
  if (paymentMethod === 'BANK_TRANSFER') return '银行转账 / Chuyển khoản';
  return undefined;
}

function defaults(): BilingualReceiptFooter {
  return { zh: DEFAULT_RECEIPT_FOOTER_ZH, vi: DEFAULT_RECEIPT_FOOTER_VI };
}
