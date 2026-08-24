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
import { assertReceiptDocument, ReceiptDocument } from '../types/receipt-document';
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
type DrawOperation =
  | { type: 'TEXT'; text: string; x: number; y: number; width: number; align: Alignment; bold: boolean; size: number }
  | { type: 'LINE'; x1: number; x2: number; y: number; thickness: number }
  | { type: 'RECT'; x: number; y: number; width: number; height: number; thickness: number };

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

@Injectable()
export class CanonicalPrintArtifactService {
  render(
    snapshot: unknown,
    paperWidth: PrintingPaperWidth,
    purpose: PrinterPurpose = PrinterPurpose.FRONT_DESK,
  ): CanonicalPrintArtifact {
    registerCanonicalFonts();
    const document = normalizeDocument(snapshot, paperWidth, purpose);
    const paper = PAPER[paperWidth];
    const measurementCanvas = createCanvas(1, 1);
    const measurement = measurementCanvas.getContext('2d');
    const { operations, height, feedLines, cutMode } = layoutDocument(
      measurement,
      document,
      paper.widthDots,
      paper.marginDots,
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
    return {
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
): PrintDocument {
  if (isPrintDocumentV2(snapshot) || isPrintDocumentV3(snapshot)) return snapshot;
  assertReceiptDocument(snapshot);
  const input = {
    receipt: snapshot as ReceiptDocument,
    paperWidth,
    purpose,
    display: canonicalReceiptDisplaySettings(DEFAULT_RECEIPT_TEMPLATE_DISPLAY),
  };
  return purpose === PrinterPurpose.KITCHEN
    ? renderPrintDocumentV2(input)
    : renderPrintDocumentV3(input);
}

function layoutDocument(
  context: CanvasContext,
  document: PrintDocument,
  widthDots: number,
  marginDots: number,
) {
  const operations: DrawOperation[] = [];
  const contentWidth = widthDots - marginDots * 2;
  let y = 18;
  let feedLines = 0;
  let cutMode: 'NONE' | 'HALF' | 'FULL' = 'NONE';
  const blocks = document.blocks as PrintBlockV3[];

  for (const block of blocks) {
    switch (block.type) {
      case 'TEXT': {
        const baseSize = fontPixels(block.fontSize);
        const fit = block.overflow === 'FIT';
        const size = fit ? fitFontSize(context, block.text, contentWidth, block.bold, baseSize) : baseSize;
        const lines = fit ? [block.text] : wrapText(context, block.text, contentWidth, block.bold, size);
        const lineHeight = Math.ceil(size * 1.35);
        for (const line of lines) {
          operations.push({ type: 'TEXT', text: line, x: marginDots, y, width: contentWidth, align: block.align, bold: block.bold, size });
          if (block.underline) operations.push({ type: 'LINE', x1: marginDots, x2: widthDots - marginDots, y: y + lineHeight - 5, thickness: 1 });
          y += lineHeight;
        }
        y += 4;
        break;
      }
      case 'ROW': {
        const size = fontPixels('NORMAL');
        const lineHeight = Math.ceil(size * 1.35);
        const rightWidth = Math.min(contentWidth * 0.56, measure(context, block.right, block.bold, size));
        const leftWidth = Math.max(40, contentWidth - rightWidth - 8);
        const leftLines = wrapText(context, block.left, leftWidth, block.bold, size);
        const rightLines = wrapText(context, block.right, rightWidth, block.bold, size);
        const lines = Math.max(leftLines.length, rightLines.length);
        for (let index = 0; index < lines; index += 1) {
          if (leftLines[index]) operations.push({ type: 'TEXT', text: leftLines[index], x: marginDots, y: y + index * lineHeight, width: leftWidth, align: 'LEFT', bold: block.bold, size });
          if (rightLines[index]) operations.push({ type: 'TEXT', text: rightLines[index], x: marginDots + leftWidth + 8, y: y + index * lineHeight, width: rightWidth, align: 'RIGHT', bold: block.bold, size });
        }
        y += lines * lineHeight + 4;
        break;
      }
      case 'COLUMNS': {
        const gap = widthDots === PAPER.MM80.widthDots ? 6 : 3;
        const totalWeight = block.cells.reduce((sum, cell) => sum + cell.weight, 0);
        const usable = contentWidth - gap * (block.cells.length - 1);
        let x = marginDots;
        const cells = block.cells.map((cell, index) => {
          const width = index === block.cells.length - 1
            ? widthDots - marginDots - x
            : Math.floor(usable * cell.weight / totalWeight);
          const size = cell.fontSize === 'LARGE' ? 28 : fontPixels(cell.fontSize);
          const fit = cell.overflow === 'FIT';
          const fitted = fit ? fitFontSize(context, cell.text, width - cell.paddingDots * 2, cell.bold, size) : size;
          const lines = index === 0
            ? wrapText(context, cell.text, width - cell.paddingDots * 2, cell.bold, fitted)
            : [cell.text];
          const result = { cell, x, width, size: fitted, lines };
          x += width + gap;
          return result;
        });
        const rowHeight = Math.max(...cells.map((cell) => cell.lines.length * Math.ceil(cell.size * 1.35)));
        for (const cell of cells) {
          const lineHeight = Math.ceil(cell.size * 1.35);
          cell.lines.forEach((line, index) => operations.push({
            type: 'TEXT', text: line, x: cell.x + cell.cell.paddingDots, y: y + index * lineHeight,
            width: cell.width - cell.cell.paddingDots * 2, align: cell.cell.align, bold: cell.cell.bold, size: cell.size,
          }));
        }
        y += rowHeight + 4;
        break;
      }
      case 'BOXED_TITLE': {
        const boxWeight = widthDots === PAPER.MM80.widthDots ? 24 : 28;
        const boxWidth = Math.floor(contentWidth * boxWeight / 100);
        const gap = widthDots === PAPER.MM80.widthDots ? 10 : 6;
        const titleX = marginDots + boxWidth + gap;
        const titleWidth = contentWidth - boxWidth - gap;
        const boxSize = fitFontSize(context, block.boxText, boxWidth - 10, true, 34);
        const titleSize = fitFontSize(context, block.title, titleWidth, true, fontPixels(block.fontSize));
        const subtitleSize = fitFontSize(context, block.subtitle, titleWidth, true, fontPixels('SMALL'));
        const height = Math.max(68, Math.ceil(titleSize * 1.35 + subtitleSize * 1.35 + 6));
        operations.push({ type: 'RECT', x: marginDots, y, width: boxWidth, height, thickness: 2 });
        operations.push({ type: 'TEXT', text: block.boxText, x: marginDots + 5, y: y + Math.floor((height - boxSize * 1.2) / 2), width: boxWidth - 10, align: 'CENTER', bold: true, size: boxSize });
        operations.push({ type: 'TEXT', text: block.title, x: titleX, y: y + 3, width: titleWidth, align: 'CENTER', bold: true, size: titleSize });
        operations.push({ type: 'TEXT', text: block.subtitle, x: titleX, y: y + Math.ceil(titleSize * 1.35) + 5, width: titleWidth, align: 'CENTER', bold: true, size: subtitleSize });
        y += height + 8;
        break;
      }
      case 'DIVIDER':
        operations.push({ type: 'LINE', x1: marginDots, x2: widthDots - marginDots, y: y + 3, thickness: 1 });
        y += 11;
        break;
      case 'FEED':
        feedLines += block.lines;
        break;
      case 'CUT':
        cutMode = block.mode;
        break;
    }
  }
  return { operations, height: Math.max(1, Math.ceil(y + 8)), feedLines, cutMode };
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
      if (!line || measure(context, line + token, bold, size) <= width) {
        line += token;
        continue;
      }
      result.push(line.trimEnd());
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
      if (alpha > 0 && luminance < 180) output[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
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
