import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { PrinterPurpose, PrintingPaperWidth } from '@prisma/client';
import GraphemeSplitter = require('grapheme-splitter');
import {
  isPrintDocumentV2,
  isPrintDocumentV3,
  PrintBlockV3,
  PrintDocument,
} from '../types/print-document';
import {
  assertReceiptDocument,
  ReceiptDocument,
  ReceiptTypeValue,
} from '../types/receipt-document';
import {
  canonicalReceiptDisplaySettings,
  renderPrintDocumentV2,
  renderPrintDocumentV3,
} from './print-document-renderer';
import { DEFAULT_RECEIPT_TEMPLATE_DISPLAY } from '../types/receipt-document';

export const CANONICAL_TEMPLATE_VERSION = 'YQ_CANONICAL_RECEIPT_V1';
export const CANONICAL_RENDER_PROTOCOL = 'ESC_POS_RASTER_V1';
export const CANONICAL_FONT_FAMILY = 'YunQiao Noto Sans SC';
export const CANONICAL_FONT_PACKAGE = '@fontsource-variable/noto-sans-sc@5.3.0';
export const CANONICAL_FONT_LICENSE = 'OFL-1.1';
export const CANONICAL_THRESHOLD = 180;
export const CANONICAL_DOTS_PER_MM = 8;
export const TABLE_BILL_LAYOUT_VERSION = 'YQ_CANONICAL_TABLE_BILL_LAYOUT_V2';
export const TABLE_BILL_ITEM_ROW_BOTTOM_DOTS = 8;
export const TABLE_BILL_FOOTER_CUT_SAFETY_DOTS = 128;
export const TABLE_BILL_ORDER_INFO_ROW_GAP_DOTS = 6;
export const TABLE_BILL_TOTAL_ROW_GAP_DOTS = 8;
export const TABLE_BILL_FINAL_TOTAL_BOTTOM_DOTS = 14;

const PAPER = {
  MM58: { widthDots: 384, paperWidthMm: 58, marginDots: 20 },
  MM80: { widthDots: 576, paperWidthMm: 80, marginDots: 30 },
} as const;
const splitter = new GraphemeSplitter();
let fontsRegistered = false;
let canonicalFontStack = `"${CANONICAL_FONT_FAMILY}"`;

type FontSize = 'SMALL' | 'NORMAL' | 'LARGE';
type Alignment = 'LEFT' | 'CENTER' | 'RIGHT';
type CanvasContext = ReturnType<ReturnType<typeof createCanvas>['getContext']>;
type LayoutProfile = 'DEFAULT' | 'TABLE_BILL_V2';
type LayoutRegion = 'GENERIC' | 'HEADER' | 'CHECKOUT' | 'ORDER_INFO' | 'ITEMS' | 'TOTALS' | 'FOOTER';
type OperationMetadata = { blockIndex: number; region: LayoutRegion };
type DrawOperation =
  | (OperationMetadata & { type: 'TEXT'; text: string; x: number; y: number; width: number; align: Alignment; bold: boolean; size: number })
  | (OperationMetadata & { type: 'LINE'; x1: number; x2: number; y: number; thickness: number })
  | (OperationMetadata & { type: 'RECT'; x: number; y: number; width: number; height: number; thickness: number });

export interface CanonicalLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanonicalLayoutDiagnostics {
  layoutVersion: typeof TABLE_BILL_LAYOUT_VERSION | 'DEFAULT';
  widthDots: number;
  heightDots: number;
  threshold: typeof CANONICAL_THRESHOLD;
  dotsPerMm: typeof CANONICAL_DOTS_PER_MM;
  footerToCutDots: number;
  footerToCutMm: number;
  visibleTextClippingCount: number;
  clippedTextSamples: string[];
  textOverlapCount: number;
  textTouchingBorderCount: number;
  ellipsisBusinessTextCount: number;
  maxDishLineCount: number;
  itemRowBottomDots: number;
  orderInfoRowGapDots: number;
  totalsRowGapDots: number;
  finalTotalBottomDots: number;
  layoutFingerprint: string;
  keyBboxes: Partial<Record<LayoutRegion, CanonicalLayoutBox>>;
}

export interface CanonicalPrintArtifact {
  canonicalTemplateVersion: typeof CANONICAL_TEMPLATE_VERSION;
  renderProtocol: typeof CANONICAL_RENDER_PROTOCOL;
  payload: Buffer;
  sha256: string;
  byteLength: number;
  paperWidthMm: 58 | 80;
  widthDots: 384 | 576;
  heightDots: number;
  font: {
    family: typeof CANONICAL_FONT_FAMILY;
    package: typeof CANONICAL_FONT_PACKAGE;
    license: typeof CANONICAL_FONT_LICENSE;
  };
}

export interface CanonicalPrintEvidence {
  artifact: CanonicalPrintArtifact;
  png: Buffer;
  layout: CanonicalLayoutDiagnostics;
}

type CanonicalRenderResult = {
  artifact: CanonicalPrintArtifact;
  png?: Buffer;
  layout?: CanonicalLayoutDiagnostics;
};

@Injectable()
export class CanonicalPrintArtifactService {
  render(
    snapshot: unknown,
    paperWidth: PrintingPaperWidth,
    purpose: PrinterPurpose = PrinterPurpose.FRONT_DESK,
    receiptType?: ReceiptTypeValue,
  ): CanonicalPrintArtifact {
    return this.renderInternal(snapshot, paperWidth, purpose, receiptType, false).artifact;
  }

  renderEvidence(
    snapshot: unknown,
    paperWidth: PrintingPaperWidth,
    purpose: PrinterPurpose = PrinterPurpose.FRONT_DESK,
    receiptType?: ReceiptTypeValue,
  ): CanonicalPrintEvidence {
    const result = this.renderInternal(snapshot, paperWidth, purpose, receiptType, true);
    return { artifact: result.artifact, png: result.png!, layout: result.layout! };
  }

  private renderInternal(
    snapshot: unknown,
    paperWidth: PrintingPaperWidth,
    purpose: PrinterPurpose,
    receiptType: ReceiptTypeValue | undefined,
    includeEvidence: boolean,
  ): CanonicalRenderResult {
    registerCanonicalFonts();
    const normalized = normalizeDocument(snapshot, paperWidth, purpose, receiptType);
    const paper = PAPER[paperWidth];
    const measurementCanvas = createCanvas(1, 1);
    const measurement = measurementCanvas.getContext('2d');
    const { operations, height, feedLines, cutMode } = layoutDocument(
      measurement,
      normalized.document,
      paper.widthDots,
      paper.marginDots,
      normalized.profile,
    );
    const canvas = createCanvas(paper.widthDots, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, paper.widthDots, height);
    context.fillStyle = '#000000';
    context.strokeStyle = '#000000';
    drawOperations(context, operations);
    const rgba = context.getImageData(0, 0, paper.widthDots, height).data;
    const raster = packMonochrome(rgba, paper.widthDots, height);
    const payload = encodeEscPos(raster, paper.widthDots, height, feedLines, cutMode);
    const artifact: CanonicalPrintArtifact = {
      canonicalTemplateVersion: CANONICAL_TEMPLATE_VERSION,
      renderProtocol: CANONICAL_RENDER_PROTOCOL,
      payload,
      sha256: createHash('sha256').update(payload).digest('hex'),
      byteLength: payload.length,
      paperWidthMm: paper.paperWidthMm,
      widthDots: paper.widthDots,
      heightDots: height,
      font: {
        family: CANONICAL_FONT_FAMILY,
        package: CANONICAL_FONT_PACKAGE,
        license: CANONICAL_FONT_LICENSE,
      },
    };
    if (!includeEvidence) return { artifact };
    return {
      artifact,
      png: canvas.toBuffer('image/png'),
      layout: inspectLayout(
        measurement,
        normalized.document,
        normalized.profile,
        operations,
        paper.widthDots,
        height,
      ),
    };
  }
}

function registerCanonicalFonts() {
  if (fontsRegistered) return;
  const packageRoot = dirname(require.resolve('@fontsource-variable/noto-sans-sc/package.json'));
  const fontsDirectory = join(packageRoot, 'files');
  const files = readdirSync(fontsDirectory)
    .filter((name) => name.endsWith('-wght-normal.woff2'))
    .sort();
  if (files.length < 100) throw new Error('CANONICAL_FONT_ASSETS_INCOMPLETE');
  const registeredFamilies: string[] = [];
  for (const [index, file] of files.entries()) {
    // Fontsource ships Noto Sans SC as deterministic unicode-range subsets.
    // Skia does not apply CSS unicode-range declarations, so each subset gets
    // a unique family and is composed into an explicit fallback stack.
    const family = `${CANONICAL_FONT_FAMILY} ${index + 1}`;
    if (!GlobalFonts.registerFromPath(join(fontsDirectory, file), family)) {
      throw new Error(`CANONICAL_FONT_REGISTRATION_FAILED:${file}`);
    }
    registeredFamilies.push(`"${family}"`);
  }
  if (registeredFamilies.length !== files.length) throw new Error('CANONICAL_FONT_UNAVAILABLE');
  canonicalFontStack = registeredFamilies.join(',');
  fontsRegistered = true;
}

function normalizeDocument(
  snapshot: unknown,
  paperWidth: PrintingPaperWidth,
  purpose: PrinterPurpose,
  receiptType?: ReceiptTypeValue,
): { document: PrintDocument; profile: LayoutProfile } {
  if (isPrintDocumentV2(snapshot) || isPrintDocumentV3(snapshot)) {
    return {
      document: snapshot,
      profile: isPrintDocumentV3(snapshot) && receiptType === 'TABLE_BILL'
        ? 'TABLE_BILL_V2'
        : 'DEFAULT',
    };
  }
  assertReceiptDocument(snapshot);
  const input = {
    receipt: snapshot as ReceiptDocument,
    paperWidth,
    purpose,
    display: canonicalReceiptDisplaySettings(DEFAULT_RECEIPT_TEMPLATE_DISPLAY),
  };
  const document = purpose === PrinterPurpose.KITCHEN
    ? renderPrintDocumentV2(input)
    : renderPrintDocumentV3(input);
  return {
    document,
    profile: document.schemaVersion === 3 && snapshot.receiptType === 'TABLE_BILL'
      ? 'TABLE_BILL_V2'
      : 'DEFAULT',
  };
}

function layoutDocument(
  context: CanvasContext,
  document: PrintDocument,
  widthDots: number,
  marginDots: number,
  profile: LayoutProfile,
) {
  const operations: DrawOperation[] = [];
  const contentWidth = widthDots - marginDots * 2;
  let y = 18;
  let feedLines = 0;
  let cutMode: 'NONE' | 'HALF' | 'FULL' = 'NONE';
  let sectionIndex = 0;
  let totalsStarted = false;
  let finalTotalSeen = false;
  let footerStarted = false;
  const blocks = document.blocks as PrintBlockV3[];

  for (const [blockIndex, block] of blocks.entries()) {
    const tableBill = profile === 'TABLE_BILL_V2';
    const defaultRegion: LayoutRegion = tableBill
      ? sectionIndex === 0
        ? 'HEADER'
        : sectionIndex === 1
          ? block.type === 'BOXED_TITLE' ? 'CHECKOUT' : 'ORDER_INFO'
          : sectionIndex === 2
            ? 'ITEMS'
            : finalTotalSeen && block.type === 'TEXT' ? 'FOOTER' : 'TOTALS'
      : 'GENERIC';
    const metadata = { blockIndex, region: defaultRegion };
    switch (block.type) {
      case 'TEXT': {
        if (tableBill && defaultRegion === 'HEADER' && block.fontSize === 'SMALL') y += 6;
        if (tableBill && defaultRegion === 'FOOTER' && !footerStarted) {
          y += 14;
          footerStarted = true;
        }
        const baseSize = fontPixels(block.fontSize);
        const fit = block.overflow === 'FIT';
        const size = fit ? fitFontSize(context, block.text, contentWidth, block.bold, baseSize) : baseSize;
        const lines = fit
          ? [block.text]
          : tableBill && defaultRegion === 'HEADER' && block.fontSize === 'SMALL'
            ? wrapCenteredText(context, block.text, contentWidth, block.bold, size)
            : wrapText(context, block.text, contentWidth, block.bold, size);
        const lineHeight = Math.ceil(size * 1.35);
        for (const line of lines) {
          operations.push({ ...metadata, type: 'TEXT', text: line, x: marginDots, y, width: contentWidth, align: block.align, bold: block.bold, size });
          if (block.underline) operations.push({ ...metadata, type: 'LINE', x1: marginDots, x2: widthDots - marginDots, y: y + lineHeight - 5, thickness: 1 });
          y += lineHeight;
        }
        y += tableBill && defaultRegion === 'HEADER'
          ? block.fontSize === 'SMALL' ? 10 : 4
          : tableBill && defaultRegion === 'FOOTER'
            ? 5
            : tableBill && defaultRegion === 'ITEMS' && !/^--+$/u.test(block.text)
              ? TABLE_BILL_ITEM_ROW_BOTTOM_DOTS
              : 4;
        break;
      }
      case 'ROW': {
        const size = tableBill && defaultRegion === 'ORDER_INFO'
          ? fontPixels('SMALL')
          : fontPixels('NORMAL');
        const lineHeight = Math.ceil(size * 1.35);
        const stable = tableBill && (defaultRegion === 'ORDER_INFO' || defaultRegion === 'TOTALS');
        if (stable && defaultRegion === 'TOTALS' && !totalsStarted) {
          y += TABLE_BILL_TOTAL_ROW_GAP_DOTS;
          totalsStarted = true;
        }
        const finalTotal = tableBill && block.left === '最终应收 / Phải thu';
        if (finalTotal) y += 6;
        const leftBold = tableBill && defaultRegion === 'ORDER_INFO' ? true : block.bold;
        const rightBold = block.bold;
        const rowGap = stable ? 12 : 8;
        const leftWidth = stable
          ? defaultRegion === 'ORDER_INFO' ? 160 : 286
          : Math.max(40, contentWidth - Math.min(contentWidth * 0.56, measure(context, block.right, rightBold, size)) - rowGap);
        const rightWidth = stable
          ? contentWidth - leftWidth - rowGap
          : Math.min(contentWidth * 0.56, measure(context, block.right, rightBold, size));
        const leftLines = wrapText(context, block.left, leftWidth, leftBold, size);
        const rightLines = wrapText(context, block.right, rightWidth, rightBold, size);
        const lines = Math.max(leftLines.length, rightLines.length);
        for (let index = 0; index < lines; index += 1) {
          if (leftLines[index]) operations.push({ ...metadata, type: 'TEXT', text: leftLines[index], x: marginDots, y: y + index * lineHeight, width: leftWidth, align: 'LEFT', bold: leftBold, size });
          if (rightLines[index]) operations.push({ ...metadata, type: 'TEXT', text: rightLines[index], x: marginDots + leftWidth + rowGap, y: y + index * lineHeight, width: rightWidth, align: 'RIGHT', bold: rightBold, size });
        }
        y += lines * lineHeight + (stable
          ? defaultRegion === 'ORDER_INFO'
            ? TABLE_BILL_ORDER_INFO_ROW_GAP_DOTS
            : finalTotal
              ? TABLE_BILL_FINAL_TOTAL_BOTTOM_DOTS
              : TABLE_BILL_TOTAL_ROW_GAP_DOTS
          : 4);
        if (finalTotal) finalTotalSeen = true;
        break;
      }
      case 'COLUMNS': {
        const tableBillItem = tableBill && defaultRegion === 'ITEMS';
        const gap = tableBillItem
          ? block.gapDots
          : widthDots === PAPER.MM80.widthDots ? 6 : 3;
        const totalWeight = block.cells.reduce((sum, cell) => sum + cell.weight, 0);
        const usable = contentWidth - gap * (block.cells.length - 1);
        let x = marginDots;
        const cells = block.cells.map((cell, index) => {
          const width = index === block.cells.length - 1
            ? widthDots - marginDots - x
            : Math.floor(usable * cell.weight / totalWeight);
          const size = cell.fontSize === 'LARGE' ? 28 : fontPixels(cell.fontSize);
          const fit = cell.overflow === 'FIT';
          const innerWidth = Math.max(1, width - cell.paddingDots * 2);
          const fitted = tableBillItem && index === 0
            ? size
            : fit ? fitFontSize(context, cell.text, innerWidth, cell.bold, size) : size;
          const lines = tableBillItem && index === 0
            ? wrapText(context, cell.text, innerWidth, cell.bold, fitted)
            : index === 0
              ? wrapText(context, cell.text, innerWidth, cell.bold, fitted)
              : measure(context, cell.text, cell.bold, fitted) <= innerWidth
                ? [cell.text]
                : wrapText(context, cell.text, innerWidth, cell.bold, fitted);
          const result = { cell, x, width, size: fitted, lines };
          x += width + gap;
          return result;
        });
        const rowHeight = Math.max(...cells.map((cell) => cell.lines.length * Math.ceil(cell.size * 1.35)));
        for (const cell of cells) {
          const lineHeight = Math.ceil(cell.size * 1.35);
          cell.lines.forEach((line, index) => operations.push({
            ...metadata, type: 'TEXT', text: line, x: cell.x + cell.cell.paddingDots, y: y + index * lineHeight,
            width: cell.width - cell.cell.paddingDots * 2, align: cell.cell.align, bold: cell.cell.bold, size: cell.size,
          }));
        }
        y += rowHeight + (tableBillItem ? TABLE_BILL_ITEM_ROW_BOTTOM_DOTS : 4);
        break;
      }
      case 'BOXED_TITLE': {
        if (tableBill) {
          y += 6;
          const boxWidth = Math.floor(contentWidth * block.boxWeight / 100);
          const gap = block.gapDots;
          const titleX = marginDots + boxWidth + gap;
          const titleWidth = contentWidth - boxWidth - gap;
          const boxSize = fontPixels('LARGE');
          const boxLineHeight = Math.ceil(boxSize * 1.3);
          const boxLines = wrapText(context, block.boxText, boxWidth - 20, true, boxSize);
          const titleSize = fontPixels(block.fontSize);
          const titleLineHeight = Math.ceil(titleSize * 1.35);
          const titleLines = wrapText(context, block.title, titleWidth, true, titleSize);
          const subtitleSize = fontPixels('SMALL');
          const subtitleLineHeight = Math.ceil(subtitleSize * 1.35);
          const subtitleLines = wrapText(context, block.subtitle, titleWidth, true, subtitleSize);
          const boxContentHeight = boxLines.length * boxLineHeight;
          const rightContentHeight = titleLines.length * titleLineHeight + 8 + subtitleLines.length * subtitleLineHeight;
          const height = Math.max(76, boxContentHeight + 20, rightContentHeight + 20);
          operations.push({ ...metadata, region: 'CHECKOUT', type: 'RECT', x: marginDots, y, width: boxWidth, height, thickness: 2 });
          const boxY = y + Math.floor((height - boxContentHeight) / 2);
          boxLines.forEach((line, index) => operations.push({
            ...metadata, region: 'CHECKOUT', type: 'TEXT', text: line,
            x: marginDots + 10, y: boxY + index * boxLineHeight,
            width: boxWidth - 20, align: 'CENTER', bold: true, size: boxSize,
          }));
          const titleY = y + Math.floor((height - rightContentHeight) / 2);
          titleLines.forEach((line, index) => operations.push({
            ...metadata, region: 'CHECKOUT', type: 'TEXT', text: line,
            x: titleX, y: titleY + index * titleLineHeight,
            width: titleWidth, align: 'CENTER', bold: true, size: titleSize,
          }));
          const subtitleY = titleY + titleLines.length * titleLineHeight + 8;
          subtitleLines.forEach((line, index) => operations.push({
            ...metadata, region: 'CHECKOUT', type: 'TEXT', text: line,
            x: titleX, y: subtitleY + index * subtitleLineHeight,
            width: titleWidth, align: 'CENTER', bold: true, size: subtitleSize,
          }));
          y += height + 14;
          break;
        }
        const boxWeight = widthDots === PAPER.MM80.widthDots ? 24 : 28;
        const boxWidth = Math.floor(contentWidth * boxWeight / 100);
        const gap = widthDots === PAPER.MM80.widthDots ? 10 : 6;
        const titleX = marginDots + boxWidth + gap;
        const titleWidth = contentWidth - boxWidth - gap;
        const boxSize = fitFontSize(context, block.boxText, boxWidth - 10, true, 34);
        const titleSize = fitFontSize(context, block.title, titleWidth, true, fontPixels(block.fontSize));
        const subtitleSize = fitFontSize(context, block.subtitle, titleWidth, true, fontPixels('SMALL'));
        const height = Math.max(68, Math.ceil(titleSize * 1.35 + subtitleSize * 1.35 + 6));
        operations.push({ ...metadata, type: 'RECT', x: marginDots, y, width: boxWidth, height, thickness: 2 });
        operations.push({ ...metadata, type: 'TEXT', text: block.boxText, x: marginDots + 5, y: y + Math.floor((height - boxSize * 1.2) / 2), width: boxWidth - 10, align: 'CENTER', bold: true, size: boxSize });
        operations.push({ ...metadata, type: 'TEXT', text: block.title, x: titleX, y: y + 3, width: titleWidth, align: 'CENTER', bold: true, size: titleSize });
        operations.push({ ...metadata, type: 'TEXT', text: block.subtitle, x: titleX, y: y + Math.ceil(titleSize * 1.35) + 5, width: titleWidth, align: 'CENTER', bold: true, size: subtitleSize });
        y += height + 8;
        break;
      }
      case 'DIVIDER': {
        const dividerPadding = tableBill ? defaultRegion === 'TOTALS' ? 10 : 8 : 3;
        operations.push({ ...metadata, type: 'LINE', x1: marginDots, x2: widthDots - marginDots, y: y + dividerPadding, thickness: 1 });
        y += tableBill ? defaultRegion === 'TOTALS' ? 22 : 18 : 11;
        sectionIndex += 1;
        break;
      }
      case 'FEED':
        if (!tableBill) feedLines += block.lines;
        break;
      case 'CUT':
        cutMode = block.mode;
        break;
    }
  }
  const cutSafetyDots = profile === 'TABLE_BILL_V2'
    ? TABLE_BILL_FOOTER_CUT_SAFETY_DOTS
    : 0;
  return {
    operations,
    height: Math.max(1, Math.ceil(y + 8 + cutSafetyDots)),
    feedLines,
    cutMode,
  };
}

function drawOperations(context: CanvasContext, operations: DrawOperation[]) {
  context.textBaseline = 'top';
  for (const operation of operations) {
    if (operation.type === 'LINE') {
      context.lineWidth = operation.thickness;
      context.beginPath();
      context.moveTo(operation.x1, operation.y);
      context.lineTo(operation.x2, operation.y);
      context.stroke();
    } else if (operation.type === 'RECT') {
      context.lineWidth = operation.thickness;
      context.strokeRect(operation.x, operation.y, operation.width, operation.height);
    } else {
      setFont(context, operation.bold, operation.size);
      const measured = context.measureText(operation.text).width;
      const x = operation.align === 'CENTER'
        ? operation.x + Math.max(0, (operation.width - measured) / 2)
        : operation.align === 'RIGHT'
          ? operation.x + Math.max(0, operation.width - measured)
          : operation.x;
      context.fillText(operation.text, x, operation.y);
    }
  }
}

function inspectLayout(
  context: CanvasContext,
  document: PrintDocument,
  profile: LayoutProfile,
  operations: DrawOperation[],
  widthDots: number,
  heightDots: number,
): CanonicalLayoutDiagnostics {
  const textOperations = operations.filter(
    (operation): operation is Extract<DrawOperation, { type: 'TEXT' }> => operation.type === 'TEXT',
  );
  const textBoxes = textOperations.map((operation) => ({
    operation,
    box: textOperationBox(context, operation),
  }));
  const clippedText = textBoxes.filter(({ operation, box }) => (
    box.x < operation.x - 0.5 ||
    box.x + box.width > operation.x + operation.width + 0.5 ||
    box.x < -0.5 ||
    box.x + box.width > widthDots + 0.5 ||
    box.y < -0.5 ||
    box.y + box.height > heightDots + 0.5
  ));
  const clippedTextSamples = clippedText.map(({ operation }) => operation.text).slice(0, 10);
  const visibleTextClippingCount = clippedText.length;
  let textOverlapCount = 0;
  for (let left = 0; left < textBoxes.length; left += 1) {
    for (let right = left + 1; right < textBoxes.length; right += 1) {
      if (boxesOverlap(textBoxes[left].box, textBoxes[right].box)) textOverlapCount += 1;
    }
  }
  const rectangles = operations.filter(
    (operation): operation is Extract<DrawOperation, { type: 'RECT' }> => operation.type === 'RECT',
  );
  const textTouchingBorderCount = textBoxes.filter(({ operation, box }) => rectangles.some((rectangle) => {
    if (rectangle.blockIndex !== operation.blockIndex) return false;
    const horizontallyInside = box.x >= rectangle.x && box.x < rectangle.x + rectangle.width;
    if (!horizontallyInside) return false;
    const inset = 6;
    return box.x < rectangle.x + inset ||
      box.x + box.width > rectangle.x + rectangle.width - inset ||
      box.y < rectangle.y + inset ||
      box.y + box.height > rectangle.y + rectangle.height - inset;
  })).length;
  const keyBboxes: CanonicalLayoutDiagnostics['keyBboxes'] = {};
  for (const operation of operations) {
    const box = operationBox(context, operation);
    keyBboxes[operation.region] = unionBoxes(keyBboxes[operation.region], box);
  }
  const footerBoxes = textBoxes.filter(({ operation }) => operation.region === 'FOOTER');
  const lastVisibleBottom = Math.max(
    0,
    ...(footerBoxes.length ? footerBoxes : textBoxes).map(({ box }) => box.y + box.height),
  );
  const ellipsisBusinessTextCount = profile === 'TABLE_BILL_V2'
    ? document.blocks.reduce((count, block) => {
        if (block.type === 'TEXT') {
          return count + Number('overflow' in block && block.overflow === 'ELLIPSIS');
        }
        if (block.type === 'COLUMNS') {
          return count + block.cells.filter((cell) => cell.overflow === 'ELLIPSIS').length;
        }
        return count;
      }, 0)
    : 0;
  const dishLineCounts = new Map<number, number>();
  textOperations.forEach((operation) => {
    if (
      operation.region === 'ITEMS' &&
      document.blocks[operation.blockIndex]?.type === 'COLUMNS'
    ) {
      dishLineCounts.set(
        operation.blockIndex,
        (dishLineCounts.get(operation.blockIndex) ?? 0) + Number(operation.align === 'LEFT'),
      );
    }
  });
  const footerToCutDots = Math.max(0, Math.floor(heightDots - lastVisibleBottom));
  const layoutFingerprint = createHash('sha256')
    .update(JSON.stringify({
      profile,
      widthDots,
      heightDots,
      operations: operations.map((operation) => Object.fromEntries(
        Object.entries(operation).map(([key, value]) => [
          key,
          typeof value === 'number' ? Math.round(value * 1_000) / 1_000 : value,
        ]),
      )),
    }))
    .digest('hex');
  return {
    layoutVersion: profile === 'TABLE_BILL_V2' ? TABLE_BILL_LAYOUT_VERSION : 'DEFAULT',
    widthDots,
    heightDots,
    threshold: CANONICAL_THRESHOLD,
    dotsPerMm: CANONICAL_DOTS_PER_MM,
    footerToCutDots,
    footerToCutMm: Math.round(footerToCutDots / CANONICAL_DOTS_PER_MM * 100) / 100,
    visibleTextClippingCount,
    clippedTextSamples,
    textOverlapCount,
    textTouchingBorderCount,
    ellipsisBusinessTextCount,
    maxDishLineCount: Math.max(0, ...dishLineCounts.values()),
    itemRowBottomDots: profile === 'TABLE_BILL_V2' ? TABLE_BILL_ITEM_ROW_BOTTOM_DOTS : 0,
    orderInfoRowGapDots: profile === 'TABLE_BILL_V2' ? TABLE_BILL_ORDER_INFO_ROW_GAP_DOTS : 0,
    totalsRowGapDots: profile === 'TABLE_BILL_V2' ? TABLE_BILL_TOTAL_ROW_GAP_DOTS : 0,
    finalTotalBottomDots: profile === 'TABLE_BILL_V2' ? TABLE_BILL_FINAL_TOTAL_BOTTOM_DOTS : 0,
    layoutFingerprint,
    keyBboxes,
  };
}

function textOperationBox(
  context: CanvasContext,
  operation: Extract<DrawOperation, { type: 'TEXT' }>,
): CanonicalLayoutBox {
  const measured = measure(context, operation.text, operation.bold, operation.size);
  const x = operation.align === 'CENTER'
    ? operation.x + Math.max(0, (operation.width - measured) / 2)
    : operation.align === 'RIGHT'
      ? operation.x + Math.max(0, operation.width - measured)
      : operation.x;
  return {
    x,
    y: operation.y,
    width: measured,
    height: Math.ceil(operation.size * 1.15),
  };
}

function operationBox(context: CanvasContext, operation: DrawOperation): CanonicalLayoutBox {
  if (operation.type === 'TEXT') return textOperationBox(context, operation);
  if (operation.type === 'RECT') {
    return { x: operation.x, y: operation.y, width: operation.width, height: operation.height };
  }
  return {
    x: operation.x1,
    y: operation.y - operation.thickness / 2,
    width: operation.x2 - operation.x1,
    height: operation.thickness,
  };
}

function boxesOverlap(left: CanonicalLayoutBox, right: CanonicalLayoutBox) {
  if (left.width <= 0 || left.height <= 0 || right.width <= 0 || right.height <= 0) return false;
  return left.x < right.x + right.width - 0.5 &&
    left.x + left.width > right.x + 0.5 &&
    left.y < right.y + right.height - 0.5 &&
    left.y + left.height > right.y + 0.5;
}

function unionBoxes(
  current: CanonicalLayoutBox | undefined,
  next: CanonicalLayoutBox,
): CanonicalLayoutBox {
  if (!current) return next;
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}

function wrapCenteredText(
  context: CanvasContext,
  text: string,
  width: number,
  bold: boolean,
  size: number,
) {
  const greedy = wrapText(context, text, width, bold, size);
  if (greedy.length !== 2 || text.includes('\n')) return greedy;
  const tokens = tokeniseForWrapping(text);
  let best: { lines: [string, string]; score: number } | undefined;
  for (let split = 1; split < tokens.length; split += 1) {
    const left = tokens.slice(0, split).join('').trim();
    const right = tokens.slice(split).join('').trim();
    if (!left || !right || left.endsWith('/') || right.startsWith('/')) continue;
    const leftWidth = measure(context, left, bold, size);
    const rightWidth = measure(context, right, bold, size);
    if (leftWidth > width || rightWidth > width) continue;
    const score = Math.abs(leftWidth - rightWidth);
    if (!best || score < best.score) best = { lines: [left, right], score };
  }
  return best?.lines ?? greedy;
}

function wrapText(context: CanvasContext, text: string, width: number, bold: boolean, size: number) {
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      result.push('');
      continue;
    }
    const tokens = tokeniseForWrapping(paragraph);
    let line = '';
    for (const token of tokens) {
      if (measure(context, line + token, bold, size) <= width) {
        line += token;
        continue;
      }
      if (line) result.push(line.trimEnd());
      if (measure(context, token, bold, size) <= width) {
        line = token.trimStart();
        continue;
      }
      const graphemes = splitter.splitGraphemes(token);
      line = '';
      for (const grapheme of graphemes) {
        if (line && measure(context, line + grapheme, bold, size) > width) {
          result.push(line);
          line = '';
        }
        line += grapheme;
      }
    }
    if (line || result.length === 0) result.push(line.trimEnd());
  }
  return result.length ? result : [''];
}

function tokeniseForWrapping(text: string) {
  const graphemes = splitter.splitGraphemes(text);
  const tokens: string[] = [];
  let latinWord = '';
  for (const grapheme of graphemes) {
    if (/^[A-Za-zÀ-ỹ0-9'’-]$/u.test(grapheme)) {
      latinWord += grapheme;
      continue;
    }
    if (latinWord) tokens.push(latinWord);
    latinWord = '';
    tokens.push(grapheme);
  }
  if (latinWord) tokens.push(latinWord);
  return tokens;
}

function fitFontSize(context: CanvasContext, text: string, width: number, bold: boolean, requested: number) {
  let size = requested;
  while (size > 14 && measure(context, text, bold, size) > width) size -= 1;
  return size;
}

function measure(context: CanvasContext, text: string, bold: boolean, size: number) {
  setFont(context, bold, size);
  return context.measureText(text).width;
}

function setFont(context: CanvasContext, bold: boolean, size: number) {
  context.font = `${bold ? 700 : 400} ${size}px ${canonicalFontStack}`;
}

function fontPixels(size: FontSize) {
  return size === 'SMALL' ? 18 : size === 'LARGE' ? 30 : 22;
}

function packMonochrome(rgba: Uint8ClampedArray, width: number, height: number) {
  const rowBytes = Math.ceil(width / 8);
  const output = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = rgba[offset + 3] / 255;
      const luminance = (rgba[offset] * 299 + rgba[offset + 1] * 587 + rgba[offset + 2] * 114) / 1000;
      if (alpha > 0 && luminance < CANONICAL_THRESHOLD) {
        output[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return output;
}

function encodeEscPos(
  raster: Buffer,
  width: number,
  height: number,
  feedLines: number,
  cutMode: 'NONE' | 'HALF' | 'FULL',
) {
  const rowBytes = Math.ceil(width / 8);
  if (height > 65_535) throw new Error('CANONICAL_RECEIPT_TOO_TALL');
  const header = Buffer.from([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    rowBytes & 0xff, (rowBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const feed = Buffer.alloc(Math.max(0, Math.min(feedLines, 20)), 0x0a);
  const cut = cutMode === 'NONE'
    ? Buffer.alloc(0)
    : Buffer.from([0x1d, 0x56, cutMode === 'HALF' ? 0x01 : 0x00]);
  return Buffer.concat([header, raster, feed, cut]);
}
