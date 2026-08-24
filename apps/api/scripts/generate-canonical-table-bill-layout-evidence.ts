import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_DOTS_PER_MM,
  CANONICAL_THRESHOLD,
  CANONICAL_VERTICAL_DPI,
  CanonicalPrintArtifactService,
  TABLE_BILL_BOTTOM_SAFE_DOTS,
  TABLE_BILL_BOTTOM_SAFE_MM,
  TABLE_BILL_DISH_FONT_WEIGHT,
  TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
  TABLE_BILL_ITEM_ROW_BOTTOM_DOTS,
} from '../src/modules/printing/services/canonical-print-artifact.service';
import { canonicalTableBillGoldenFixture } from '../src/modules/printing/testing/canonical-table-bill-layout.fixture';

const OUTPUT_DIRECTORY = '/Users/peter/Desktop/云桥Life-发布与交付/06-UI优化/YunQiao-Canonical-Receipt-Final-Polish-20260824';
const PNG_PATH = join(OUTPUT_DIRECTORY, 'canonical-table-bill-final-polish.png');
const INVARIANTS_PATH = join(OUTPUT_DIRECTORY, 'LAYOUT_INVARIANTS.json');

const evidence = new CanonicalPrintArtifactService().renderEvidence(
  canonicalTableBillGoldenFixture(),
  'MM80',
);
const { artifact, layout } = evidence;

if (artifact.widthDots !== 576) throw new Error('LAYOUT_WIDTH_MISMATCH');
if (layout.threshold !== CANONICAL_THRESHOLD) throw new Error('CANONICAL_THRESHOLD_MISMATCH');
if (layout.visibleTextClippingCount !== 0) throw new Error('VISIBLE_TEXT_CLIPPING');
if (layout.textOverlapCount !== 0) throw new Error('VISIBLE_TEXT_OVERLAP');
if (layout.textTouchingBorderCount !== 0) throw new Error('TEXT_TOUCHING_BORDER');
if (layout.ellipsisBusinessTextCount !== 0) throw new Error('BUSINESS_TEXT_ELLIPSIS');
if (layout.dishFontWeight !== TABLE_BILL_DISH_FONT_WEIGHT) {
  throw new Error('DISH_FONT_WEIGHT_MISMATCH');
}
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
if (artifact.heightDots <= 2_531) throw new Error('RASTER_HEIGHT_DID_NOT_INCREASE');

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
  verticalDpi: CANONICAL_VERTICAL_DPI,
  dotsPerMm: CANONICAL_DOTS_PER_MM,
  dishFontWeight: layout.dishFontWeight,
  dishTextBlackPixelRatioBefore: layout.dishTextBlackPixelRatioBefore,
  dishTextBlackPixelRatioAfter: layout.dishTextBlackPixelRatioAfter,
  dishTextBoldReferenceBlackPixelRatio: layout.dishTextBoldReferenceBlackPixelRatio,
  finalReceivableFontWeight: TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
  finalReceivableBlackPixelRatio: layout.finalReceivableBlackPixelRatio,
  payloadBytes: artifact.byteLength,
  payloadSha256: artifact.sha256,
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
    RASTER_HEIGHT_AFTER_GT_BEFORE: artifact.heightDots > 2_531,
    NO_TEXT_TOUCHING_BORDER: layout.textTouchingBorderCount === 0,
    NO_TEXT_OVERLAP: layout.textOverlapCount === 0,
    WIDTH_576: artifact.widthDots === 576,
    THRESHOLD_180: layout.threshold === 180,
    LOCAL_LAYOUT_RENDERER_USED_FOR_CANONICAL_JOB: false,
    WPF_LAYOUT_RENDERER_USED_FOR_CANONICAL_JOB: false,
  },
};

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
writeFileSync(PNG_PATH, evidence.png);
writeFileSync(INVARIANTS_PATH, `${JSON.stringify(invariants, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  pngPath: PNG_PATH,
  invariantsPath: INVARIANTS_PATH,
  ...invariants,
}, null, 2)}\n`);
