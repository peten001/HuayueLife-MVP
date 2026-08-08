export const PRINT_DOCUMENT_SCHEMA_VERSION = 2 as const;
export const PRINT_DOCUMENT_TYPES = ['PRINT_DOCUMENT'] as const;
export const PRINT_PAPER_WIDTHS = ['MM58', 'MM80'] as const;
export const PRINT_ALIGNMENTS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export const PRINT_FONT_SIZES = ['SMALL', 'NORMAL', 'LARGE'] as const;
export const PRINT_CUT_MODES = ['NONE', 'HALF', 'FULL'] as const;

export type PrintBlock =
  | {
      type: 'TEXT';
      text: string;
      align: (typeof PRINT_ALIGNMENTS)[number];
      bold: boolean;
      fontSize: (typeof PRINT_FONT_SIZES)[number];
      underline: boolean;
    }
  | { type: 'ROW'; left: string; right: string; bold: boolean }
  | { type: 'DIVIDER' }
  | { type: 'FEED'; lines: number }
  | { type: 'CUT'; mode: (typeof PRINT_CUT_MODES)[number] };

/**
 * Presentation-only print protocol. It intentionally contains no order,
 * settlement, discount, rounding, item-category, or receipt-type semantics.
 */
export interface PrintDocumentV2 {
  documentType: 'PRINT_DOCUMENT';
  schemaVersion: 2;
  paperWidth: (typeof PRINT_PAPER_WIDTHS)[number];
  copies: number;
  blocks: PrintBlock[];
}

export function isPrintDocumentV2(value: unknown): value is PrintDocumentV2 {
  return (
    isPlainObject(value) &&
    value.documentType === 'PRINT_DOCUMENT' &&
    value.schemaVersion === 2
  );
}

export function assertPrintDocumentV2(value: unknown): asserts value is PrintDocumentV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'documentType', 'schemaVersion', 'paperWidth', 'copies', 'blocks',
  ])) {
    throw new Error('Print document must be a supported object');
  }
  if (
    value.documentType !== 'PRINT_DOCUMENT' ||
    value.schemaVersion !== PRINT_DOCUMENT_SCHEMA_VERSION ||
    !PRINT_PAPER_WIDTHS.includes(value.paperWidth as never) ||
    !Number.isSafeInteger(value.copies) ||
    Number(value.copies) < 1 ||
    Number(value.copies) > 10 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length < 1 ||
    value.blocks.length > 2_000
  ) {
    throw new Error('Print document does not match schema version 2');
  }
  value.blocks.forEach((block, index) => assertBlock(block, index));
  const cutIndexes = value.blocks
    .map((block, index) => isPlainObject(block) && block.type === 'CUT' ? index : -1)
    .filter((index) => index >= 0);
  if (cutIndexes.length > 1 || (cutIndexes.length === 1 && cutIndexes[0] !== value.blocks.length - 1)) {
    throw new Error('CUT must be the final and only CUT block');
  }
}

function assertBlock(value: unknown, index: number) {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new Error(`Print block ${index} is invalid`);
  }
  switch (value.type) {
    case 'TEXT':
      if (
        !hasOnlyKeys(value, ['type', 'text', 'align', 'bold', 'fontSize', 'underline']) ||
        !boundedText(value.text, 0, 2_000) ||
        !PRINT_ALIGNMENTS.includes(value.align as never) ||
        typeof value.bold !== 'boolean' ||
        !PRINT_FONT_SIZES.includes(value.fontSize as never) ||
        typeof value.underline !== 'boolean'
      ) throw new Error(`TEXT block ${index} is invalid`);
      return;
    case 'ROW':
      if (
        !hasOnlyKeys(value, ['type', 'left', 'right', 'bold']) ||
        !boundedText(value.left, 0, 1_000) ||
        !boundedText(value.right, 0, 1_000) ||
        typeof value.bold !== 'boolean'
      ) throw new Error(`ROW block ${index} is invalid`);
      return;
    case 'DIVIDER':
      if (!hasOnlyKeys(value, ['type'])) throw new Error(`DIVIDER block ${index} is invalid`);
      return;
    case 'FEED':
      if (
        !hasOnlyKeys(value, ['type', 'lines']) ||
        !Number.isSafeInteger(value.lines) ||
        !inRange(Number(value.lines), 1, 20)
      ) {
        throw new Error(`FEED block ${index} is invalid`);
      }
      return;
    case 'CUT':
      if (
        !hasOnlyKeys(value, ['type', 'mode']) ||
        !PRINT_CUT_MODES.includes(value.mode as never)
      ) {
        throw new Error(`CUT block ${index} is invalid`);
      }
      return;
    default:
      throw new Error(`Print block ${index} type is unsupported`);
  }
}

function boundedText(value: unknown, min: number, max: number) {
  return typeof value === 'string' && value.length >= min && value.length <= max && !value.includes('\0');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function inRange(value: number, min: number, max: number) {
  return value >= min && value <= max;
}
