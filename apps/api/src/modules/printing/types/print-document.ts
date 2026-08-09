export const PRINT_DOCUMENT_SCHEMA_V2 = 2 as const;
export const PRINT_DOCUMENT_SCHEMA_V3 = 3 as const;
export const PRINT_DOCUMENT_SCHEMA_VERSION = PRINT_DOCUMENT_SCHEMA_V2;
export const PRINT_DOCUMENT_TYPES = ['PRINT_DOCUMENT'] as const;
export const PRINT_PAPER_WIDTHS = ['MM58', 'MM80'] as const;
export const PRINT_ALIGNMENTS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export const PRINT_FONT_SIZES = ['SMALL', 'NORMAL', 'LARGE'] as const;
export const PRINT_CUT_MODES = ['NONE', 'HALF', 'FULL'] as const;
export const PRINT_COLUMN_OVERFLOWS = ['ELLIPSIS', 'FIT'] as const;

export type TextPrintBlock = {
  type: 'TEXT';
  text: string;
  align: (typeof PRINT_ALIGNMENTS)[number];
  bold: boolean;
  fontSize: (typeof PRINT_FONT_SIZES)[number];
  underline: boolean;
};

export type TextPrintBlockV3 = TextPrintBlock & {
  overflow?: (typeof PRINT_COLUMN_OVERFLOWS)[number];
};

export type RowPrintBlock = { type: 'ROW'; left: string; right: string; bold: boolean };
export type DividerPrintBlock = { type: 'DIVIDER' };
export type FeedPrintBlock = { type: 'FEED'; lines: number };
export type CutPrintBlock = { type: 'CUT'; mode: (typeof PRINT_CUT_MODES)[number] };

export type PrintBlock =
  | TextPrintBlock
  | RowPrintBlock
  | DividerPrintBlock
  | FeedPrintBlock
  | CutPrintBlock;

export interface PrintColumnCell {
  text: string;
  weight: number;
  align: (typeof PRINT_ALIGNMENTS)[number];
  bold: boolean;
  fontSize: (typeof PRINT_FONT_SIZES)[number];
  overflow: (typeof PRINT_COLUMN_OVERFLOWS)[number];
  paddingDots: number;
}

export type ColumnsPrintBlock = {
  type: 'COLUMNS';
  gapDots: number;
  cells: PrintColumnCell[];
};

export type BoxedTitlePrintBlock = {
  type: 'BOXED_TITLE';
  boxText: string;
  title: string;
  subtitle: string;
  boxWeight: number;
  gapDots: number;
  fontSize: (typeof PRINT_FONT_SIZES)[number];
};

export type PrintBlockV3 =
  | Exclude<PrintBlock, TextPrintBlock>
  | TextPrintBlockV3
  | ColumnsPrintBlock
  | BoxedTitlePrintBlock;

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

/** Schema 3 retains every V2 block and adds measured pixel-column primitives. */
export interface PrintDocumentV3 {
  documentType: 'PRINT_DOCUMENT';
  schemaVersion: 3;
  paperWidth: (typeof PRINT_PAPER_WIDTHS)[number];
  copies: number;
  blocks: PrintBlockV3[];
}

export type PrintDocument = PrintDocumentV2 | PrintDocumentV3;

export function isPrintDocumentV2(value: unknown): value is PrintDocumentV2 {
  return isPrintDocumentVersion(value, PRINT_DOCUMENT_SCHEMA_V2);
}

export function isPrintDocumentV3(value: unknown): value is PrintDocumentV3 {
  return isPrintDocumentVersion(value, PRINT_DOCUMENT_SCHEMA_V3);
}

export function isPrintDocument(value: unknown): value is PrintDocument {
  return isPrintDocumentV2(value) || isPrintDocumentV3(value);
}

export function assertPrintDocumentV2(value: unknown): asserts value is PrintDocumentV2 {
  assertPrintDocument(value, PRINT_DOCUMENT_SCHEMA_V2);
}

export function assertPrintDocumentV3(value: unknown): asserts value is PrintDocumentV3 {
  assertPrintDocument(value, PRINT_DOCUMENT_SCHEMA_V3);
}

function isPrintDocumentVersion(value: unknown, schemaVersion: 2 | 3) {
  return (
    isPlainObject(value) &&
    value.documentType === 'PRINT_DOCUMENT' &&
    value.schemaVersion === schemaVersion
  );
}

function assertPrintDocument(
  value: unknown,
  schemaVersion: 2 | 3,
): asserts value is PrintDocument {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'documentType', 'schemaVersion', 'paperWidth', 'copies', 'blocks',
  ])) {
    throw new Error('Print document must be a supported object');
  }
  if (
    value.documentType !== 'PRINT_DOCUMENT' ||
    value.schemaVersion !== schemaVersion ||
    !PRINT_PAPER_WIDTHS.includes(value.paperWidth as never) ||
    !Number.isSafeInteger(value.copies) ||
    Number(value.copies) < 1 ||
    Number(value.copies) > 10 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length < 1 ||
    value.blocks.length > 2_000
  ) {
    throw new Error(`Print document does not match schema version ${schemaVersion}`);
  }
  value.blocks.forEach((block, index) => assertBlock(block, index, schemaVersion));
  const cutIndexes = value.blocks
    .map((block, index) => isPlainObject(block) && block.type === 'CUT' ? index : -1)
    .filter((index) => index >= 0);
  if (cutIndexes.length > 1 || (cutIndexes.length === 1 && cutIndexes[0] !== value.blocks.length - 1)) {
    throw new Error('CUT must be the final and only CUT block');
  }
}

function assertBlock(value: unknown, index: number, schemaVersion: 2 | 3) {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new Error(`Print block ${index} is invalid`);
  }
  switch (value.type) {
    case 'TEXT':
      if (
        !hasOnlyKeys(value, schemaVersion === PRINT_DOCUMENT_SCHEMA_V3
          ? ['type', 'text', 'align', 'bold', 'fontSize', 'underline', 'overflow']
          : ['type', 'text', 'align', 'bold', 'fontSize', 'underline']) ||
        !boundedText(value.text, 0, 2_000) ||
        !PRINT_ALIGNMENTS.includes(value.align as never) ||
        typeof value.bold !== 'boolean' ||
        !PRINT_FONT_SIZES.includes(value.fontSize as never) ||
        typeof value.underline !== 'boolean' ||
        (value.overflow !== undefined && !PRINT_COLUMN_OVERFLOWS.includes(value.overflow as never))
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
    case 'COLUMNS':
      if (schemaVersion !== PRINT_DOCUMENT_SCHEMA_V3) {
        throw new Error(`Print block ${index} type is unsupported`);
      }
      assertColumnsBlock(value, index);
      return;
    case 'BOXED_TITLE':
      if (schemaVersion !== PRINT_DOCUMENT_SCHEMA_V3) {
        throw new Error(`Print block ${index} type is unsupported`);
      }
      if (
        !hasOnlyKeys(value, [
          'type', 'boxText', 'title', 'subtitle', 'boxWeight', 'gapDots', 'fontSize',
        ]) ||
        !boundedText(value.boxText, 1, 64) ||
        !boundedText(value.title, 1, 200) ||
        !boundedText(value.subtitle, 1, 64) ||
        !Number.isSafeInteger(value.boxWeight) ||
        !inRange(Number(value.boxWeight), 10, 50) ||
        !Number.isSafeInteger(value.gapDots) ||
        !inRange(Number(value.gapDots), 0, 40) ||
        !PRINT_FONT_SIZES.includes(value.fontSize as never)
      ) {
        throw new Error(`BOXED_TITLE block ${index} is invalid`);
      }
      return;
    default:
      throw new Error(`Print block ${index} type is unsupported`);
  }
}

function assertColumnsBlock(value: Record<string, unknown>, index: number) {
  if (
    !hasOnlyKeys(value, ['type', 'gapDots', 'cells']) ||
    !Number.isSafeInteger(value.gapDots) ||
    !inRange(Number(value.gapDots), 0, 40) ||
    !Array.isArray(value.cells) ||
    !inRange(value.cells.length, 2, 4)
  ) {
    throw new Error(`COLUMNS block ${index} is invalid`);
  }
  value.cells.forEach((cell, cellIndex) => {
    if (
      !isPlainObject(cell) ||
      !hasOnlyKeys(cell, [
        'text', 'weight', 'align', 'bold', 'fontSize', 'overflow', 'paddingDots',
      ]) ||
      !boundedText(cell.text, 0, 2_000) ||
      !Number.isSafeInteger(cell.weight) ||
      !inRange(Number(cell.weight), 1, 100) ||
      !PRINT_ALIGNMENTS.includes(cell.align as never) ||
      typeof cell.bold !== 'boolean' ||
      !PRINT_FONT_SIZES.includes(cell.fontSize as never) ||
      !PRINT_COLUMN_OVERFLOWS.includes(cell.overflow as never) ||
      !Number.isSafeInteger(cell.paddingDots) ||
      !inRange(Number(cell.paddingDots), 0, 24)
    ) {
      throw new Error(`COLUMNS block ${index} cell ${cellIndex} is invalid`);
    }
  });
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
