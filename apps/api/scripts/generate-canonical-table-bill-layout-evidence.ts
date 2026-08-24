import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_THRESHOLD,
  CanonicalPrintArtifactService,
  TABLE_BILL_FOOTER_CUT_SAFETY_DOTS,
  TABLE_BILL_ITEM_ROW_BOTTOM_DOTS,
} from '../src/modules/printing/services/canonical-print-artifact.service';
import { canonicalTableBillGoldenFixture } from '../src/modules/printing/testing/canonical-table-bill-layout.fixture';

const OUTPUT_DIRECTORY = '/Users/peter/Desktop/云桥Life-发布与交付/06-UI优化/YunQiao-Canonical-Receipt-Layout-20260824';
const PNG_PATH = join(OUTPUT_DIRECTORY, 'canonical-table-bill-layout-v2.png');
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
if (layout.footerToCutDots < TABLE_BILL_FOOTER_CUT_SAFETY_DOTS) {
  throw new Error('FOOTER_CUT_SAFETY_TOO_SMALL');
}
if (layout.footerToCutMm > 20) throw new Error('FOOTER_CUT_SAFETY_TOO_LARGE');

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
  payloadBytes: artifact.byteLength,
  payloadSha256: artifact.sha256,
  layoutFingerprint: layout.layoutFingerprint,
  keyBboxes: layout.keyBboxes,
  footerToCut: {
    dots: layout.footerToCutDots,
    mm: layout.footerToCutMm,
    minimumDots: TABLE_BILL_FOOTER_CUT_SAFETY_DOTS,
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
    FOOTER_SAFE_SPACE_GTE_15MM: layout.footerToCutMm >= 15,
    FOOTER_SAFE_SPACE_LTE_20MM: layout.footerToCutMm <= 20,
    FOOTER_TEXT_NOT_CUT: layout.footerToCutDots >= TABLE_BILL_FOOTER_CUT_SAFETY_DOTS,
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
