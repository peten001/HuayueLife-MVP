export const DEFAULT_RECEIPT_FOOTER_ZH = '谢谢惠顾，欢迎再次光临';
export const DEFAULT_RECEIPT_FOOTER_VI = 'Cảm ơn quý khách, hẹn gặp lại!';

export interface BilingualReceiptFooter {
  zh: string;
  vi: string;
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

function defaults(): BilingualReceiptFooter {
  return { zh: DEFAULT_RECEIPT_FOOTER_ZH, vi: DEFAULT_RECEIPT_FOOTER_VI };
}
