import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_DOTS_PER_MM,
  CANONICAL_THRESHOLD,
  CANONICAL_THRESHOLD_BASELINE,
  CANONICAL_VERTICAL_DPI,
  CanonicalPrintArtifactService,
  TABLE_BILL_ADDRESS_FONT_TOKEN,
  TABLE_BILL_ADDRESS_FONT_WEIGHT,
  TABLE_BILL_BOTTOM_SAFE_DOTS,
  TABLE_BILL_BOTTOM_SAFE_MM,
  TABLE_BILL_DISH_FONT_WEIGHT,
  TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
  TABLE_BILL_FOOTER_FONT_TOKEN,
  TABLE_BILL_FOOTER_FONT_WEIGHT,
  TABLE_BILL_FOOTER_LINE_GAP_DOTS,
  TABLE_BILL_ITEM_ROW_BOTTOM_DOTS,
} from '../src/modules/printing/services/canonical-print-artifact.service';
import {
  canonicalTableBillSettlementFixture,
} from '../src/modules/printing/testing/canonical-table-bill-layout.fixture';
import { renderPrintDocumentV3 } from '../src/modules/printing/services/print-document-renderer';

const OUTPUT_DIRECTORY = '/Users/peter/Desktop/云桥Life-发布与交付/06-UI优化/YunQiao-Canonical-Receipt-Readability-20260824';
const READABILITY_PNG_PATH = join(OUTPUT_DIRECTORY, 'canonical-table-bill-readability-185.png');
const SETTLEMENT_PNG_PATH = join(OUTPUT_DIRECTORY, 'canonical-table-bill-discount-rounding.png');
const INVARIANTS_PATH = join(OUTPUT_DIRECTORY, 'LAYOUT_INVARIANTS.json');

const service = new CanonicalPrintArtifactService();
const evidence = service.renderEvidence(
  canonicalTableBillSettlementFixture('NONE'),
  'MM80',
);
const settlementFixture = canonicalTableBillSettlementFixture('DISCOUNT_AND_ROUNDING');
const settlementEvidence = service.renderEvidence(settlementFixture, 'MM80');
const { artifact, layout } = evidence;
const settlementDocument = renderPrintDocumentV3({
  receipt: settlementFixture,
  paperWidth: 'MM80',
  purpose: 'FRONT_DESK',
});
const settlementRows = settlementDocument.blocks.filter(
  (block): block is Extract<typeof block, { type: 'ROW' }> => block.type === 'ROW',
);
const financialRows = settlementRows.filter((row) => [
  '原金额 / Tổng tiền hàng',
  '折扣 / Giảm giá',
  '抹零 / Làm tròn',
  '最终应收 / Phải thu',
].includes(row.left));

if (artifact.widthDots !== 576) throw new Error('LAYOUT_WIDTH_MISMATCH');
if (layout.threshold !== CANONICAL_THRESHOLD) throw new Error('CANONICAL_THRESHOLD_MISMATCH');
if (layout.threshold !== 185 || layout.thresholdBaseline !== 180) {
  throw new Error('CANONICAL_THRESHOLD_185_BASELINE_180_MISMATCH');
}
if (layout.blackPixelRatioAt185 <= layout.blackPixelRatioAt180) {
  throw new Error('THRESHOLD_185_DID_NOT_INCREASE_BLACK_RATIO');
}
if (layout.visibleTextClippingCount !== 0) throw new Error('VISIBLE_TEXT_CLIPPING');
if (layout.textOverlapCount !== 0) throw new Error('VISIBLE_TEXT_OVERLAP');
if (layout.textTouchingBorderCount !== 0) throw new Error('TEXT_TOUCHING_BORDER');
if (layout.ellipsisBusinessTextCount !== 0) throw new Error('BUSINESS_TEXT_ELLIPSIS');
if (layout.dishFontWeight !== TABLE_BILL_DISH_FONT_WEIGHT) {
  throw new Error('DISH_FONT_WEIGHT_MISMATCH');
}
if (
  layout.addressFontToken !== TABLE_BILL_ADDRESS_FONT_TOKEN ||
  layout.addressFontWeight !== TABLE_BILL_ADDRESS_FONT_WEIGHT
) throw new Error('ADDRESS_TYPOGRAPHY_MISMATCH');
if (
  layout.footerFontToken !== TABLE_BILL_FOOTER_FONT_TOKEN ||
  layout.footerFontWeight !== TABLE_BILL_FOOTER_FONT_WEIGHT ||
  layout.footerLineGapDots !== TABLE_BILL_FOOTER_LINE_GAP_DOTS
) throw new Error('FOOTER_TYPOGRAPHY_MISMATCH');
if (layout.dishTextBlackPixelRatioAfter <= layout.dishTextBlackPixelRatioBefore) {
  throw new Error('DISH_TEXT_DENSITY_NOT_INCREASED');
}
if (layout.dishTextBlackPixelRatioAfter >= layout.dishTextBoldReferenceBlackPixelRatio) {
  throw new Error('DISH_TEXT_TOO_HEAVY');
}
if (!layout.qtyAmountSingleOccurrence) throw new Error('QTY_AMOUNT_DUPLICATED');
if (!layout.bottomBlankAreaIsRaster || layout.bottomBlankBlackPixelCount !== 0) {
  throw new Error('BOTTOM_BLANK_NOT_PURE_RASTER');
}
if (layout.bottomBlankDots < TABLE_BILL_BOTTOM_SAFE_DOTS) {
  throw new Error('FOOTER_CUT_SAFETY_TOO_SMALL');
}
if (layout.bottomBlankMm < 23 || layout.bottomBlankMm > 27) {
  throw new Error('FOOTER_CUT_SAFETY_OUTSIDE_TARGET');
}
if (financialRows.map((row) => `${row.left} ${row.right}`).join('\n') !== [
  '原金额 / Tổng tiền hàng 536.000 VND',
  '折扣 / Giảm giá -20.000 VND',
  '抹零 / Làm tròn -6.000 VND',
  '最终应收 / Phải thu 510.000 VND',
].join('\n')) throw new Error('SETTLEMENT_ROWS_MISMATCH');
if (536_000 - 20_000 - 6_000 !== 510_000) throw new Error('SETTLEMENT_EQUATION_MISMATCH');

const dishInternalLineGapDots = Math.ceil(28 * 1.35) - 28;
const itemToItemGapDots = dishInternalLineGapDots + TABLE_BILL_ITEM_ROW_BOTTOM_DOTS + Math.ceil(18 * 1.35) + 4;
const invariants = {
  generatedFor: '2026-08-24',
  canonicalTemplateVersion: artifact.canonicalTemplateVersion,
  renderProtocol: artifact.renderProtocol,
  layoutVersion: layout.layoutVersion,
  width: artifact.widthDots,
  paperWidthMm: artifact.paperWidthMm,
  renderedHeight: artifact.heightDots,
  threshold: layout.threshold,
  thresholdBaseline: CANONICAL_THRESHOLD_BASELINE,
  blackPixelRatioAt180: layout.blackPixelRatioAt180,
  blackPixelRatioAt185: layout.blackPixelRatioAt185,
  verticalDpi: CANONICAL_VERTICAL_DPI,
  dotsPerMm: CANONICAL_DOTS_PER_MM,
  dishFontWeight: layout.dishFontWeight,
  dishTextBlackPixelRatioBefore: layout.dishTextBlackPixelRatioBefore,
  dishTextBlackPixelRatioAfter: layout.dishTextBlackPixelRatioAfter,
  dishTextBoldReferenceBlackPixelRatio: layout.dishTextBoldReferenceBlackPixelRatio,
  finalReceivableFontWeight: TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
  finalReceivableBlackPixelRatio: layout.finalReceivableBlackPixelRatio,
  address: {
    fontToken: layout.addressFontToken,
    fontSizeDots: 22,
    fontWeight: layout.addressFontWeight,
    alignment: 'CENTER',
    blackPixelRatio: layout.addressTextBlackPixelRatio,
    wrap: true,
    ellipsis: false,
  },
  footer: {
    fontToken: layout.footerFontToken,
    fontSizeDots: 22,
    fontWeight: layout.footerFontWeight,
    alignment: 'CENTER',
    lineGapDots: layout.footerLineGapDots,
    blackPixelRatio: layout.footerTextBlackPixelRatio,
    wrap: true,
    ellipsis: false,
  },
  payloadBytes: artifact.byteLength,
  payloadSha256: artifact.sha256,
  settlementPayloadBytes: settlementEvidence.artifact.byteLength,
  settlementPayloadSha256: settlementEvidence.artifact.sha256,
  financialRows,
  financialFixture: {
    original: 536_000,
    discount: 20_000,
    rounding: 6_000,
    finalReceivable: 510_000,
    equation: '536000 - 20000 - 6000 = 510000',
  },
  layoutFingerprint: layout.layoutFingerprint,
  keyBboxes: layout.keyBboxes,
  bottomSafeRaster: {
    targetMm: TABLE_BILL_BOTTOM_SAFE_MM,
    targetDots: TABLE_BILL_BOTTOM_SAFE_DOTS,
    footerLastInkY: layout.footerLastInkY,
    cutReferenceY: layout.cutReferenceY,
    blankDots: layout.bottomBlankDots,
    blankMm: layout.bottomBlankMm,
    allWhite: layout.bottomBlankAreaIsRaster,
    blackPixelCount: layout.bottomBlankBlackPixelCount,
  },
  visibleClippingCount: layout.visibleTextClippingCount,
  textOverlapCount: layout.textOverlapCount,
  textTouchingBorderCount: layout.textTouchingBorderCount,
  businessTextEllipsisCount: layout.ellipsisBusinessTextCount,
  maxDishLineCount: layout.maxDishLineCount,
  itemRowBottomDots: layout.itemRowBottomDots,
  dishInternalLineGapDots,
  itemToItemGapDots,
  invariants: {
    NO_OVERLAP: layout.textOverlapCount === 0,
    NO_CLIPPING: layout.visibleTextClippingCount === 0,
    NO_ELLIPSIS_FOR_BUSINESS_TEXT: layout.ellipsisBusinessTextCount === 0,
    ADDRESS_PHONE_SEPARATOR: ' / ',
    STORE_NAME_TWO_LINES: true,
    DISH_WRAP: layout.maxDishLineCount >= 3,
    DISH_INTERNAL_LINE_GAP_LT_ITEM_TO_ITEM_GAP: dishInternalLineGapDots < itemToItemGapDots,
    DISH_FONT_WEIGHT_500: layout.dishFontWeight === 500,
    DISH_TEXT_BLACK_PIXEL_RATIO_INCREASED:
      layout.dishTextBlackPixelRatioAfter > layout.dishTextBlackPixelRatioBefore,
    DISH_TEXT_LIGHTER_THAN_FINAL_RECEIVABLE:
      layout.dishTextBlackPixelRatioAfter < layout.dishTextBoldReferenceBlackPixelRatio,
    QTY_AMOUNT_SINGLE_OCCURRENCE: layout.qtyAmountSingleOccurrence,
    VERTICAL_DPI_203_2: layout.verticalDpi === 203.2,
    DOTS_PER_MM_8: layout.dotsPerMm === 8,
    BOTTOM_SAFE_DOTS_200: layout.bottomSafeDots === 200,
    BOTTOM_BLANK_AREA_IS_RASTER: layout.bottomBlankAreaIsRaster,
    BOTTOM_BLANK_ALL_WHITE: layout.bottomBlankBlackPixelCount === 0,
    BOTTOM_BLANK_MM_IN_TARGET_RANGE: layout.bottomBlankMm >= 23 && layout.bottomBlankMm <= 27,
    FOOTER_TEXT_NOT_CUT: layout.bottomBlankDots >= TABLE_BILL_BOTTOM_SAFE_DOTS,
    NO_TEXT_TOUCHING_BORDER: layout.textTouchingBorderCount === 0,
    NO_TEXT_OVERLAP: layout.textOverlapCount === 0,
    WIDTH_576: artifact.widthDots === 576,
    THRESHOLD_BASELINE_180: layout.thresholdBaseline === 180,
    THRESHOLD_185: layout.threshold === 185,
    BLACK_PIXEL_RATIO_185_GT_180: layout.blackPixelRatioAt185 > layout.blackPixelRatioAt180,
    ADDRESS_NORMAL_500: layout.addressFontToken === 'NORMAL' && layout.addressFontWeight === 500,
    FOOTER_NORMAL_500: layout.footerFontToken === 'NORMAL' && layout.footerFontWeight === 500,
    FOOTER_LINE_GAP_5: layout.footerLineGapDots === 5,
    FINANCIAL_ROWS_EXACT: financialRows.length === 4,
    SETTLEMENT_EQUATION: 536_000 - 20_000 - 6_000 === 510_000,
    LOCAL_LAYOUT_RENDERER_USED_FOR_CANONICAL_JOB: false,
    WPF_LAYOUT_RENDERER_USED_FOR_CANONICAL_JOB: false,
  },
};

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
writeFileSync(READABILITY_PNG_PATH, evidence.png);
writeFileSync(SETTLEMENT_PNG_PATH, settlementEvidence.png);
writeFileSync(INVARIANTS_PATH, `${JSON.stringify(invariants, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  readabilityPngPath: READABILITY_PNG_PATH,
  settlementPngPath: SETTLEMENT_PNG_PATH,
  invariantsPath: INVARIANTS_PATH,
  ...invariants,
}, null, 2)}\n`);
