import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  CANONICAL_DOTS_PER_MM,
  CANONICAL_FONT_FAMILY,
  CANONICAL_FONT_LICENSE,
  CANONICAL_FONT_PACKAGE,
  CANONICAL_THRESHOLD,
  CANONICAL_VERTICAL_DPI,
  CanonicalPrintArtifactService,
  TABLE_BILL_BOTTOM_SAFE_DOTS,
  TABLE_BILL_BOTTOM_SAFE_MM,
  TABLE_BILL_DISH_FONT_WEIGHT,
  TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
  TABLE_BILL_FINAL_TOTAL_BOTTOM_DOTS,
  TABLE_BILL_ITEM_ROW_BOTTOM_DOTS,
  TABLE_BILL_LAYOUT_VERSION,
  TABLE_BILL_ORDER_INFO_ROW_GAP_DOTS,
  TABLE_BILL_TOTAL_ROW_GAP_DOTS,
} from './canonical-print-artifact.service';
import { renderPrintDocumentV3 } from './print-document-renderer';
import { canonicalTableBillGoldenFixture } from '../testing/canonical-table-bill-layout.fixture';

describe('CanonicalPrintArtifactService', () => {
  const service = new CanonicalPrintArtifactService();

  it('renders the anonymous 14-dish 80mm golden receipt deterministically', () => {
    const first = service.renderEvidence(goldenDocument(14), 'MM80');
    const second = service.renderEvidence(goldenDocument(14), 'MM80');

    expect(CANONICAL_THRESHOLD).toBe(180);
    expect(CANONICAL_VERTICAL_DPI / 25.4).toBe(CANONICAL_DOTS_PER_MM);
    expect(TABLE_BILL_BOTTOM_SAFE_DOTS).toBe(Math.round(
      TABLE_BILL_BOTTOM_SAFE_MM * CANONICAL_DOTS_PER_MM,
    ));
    expect(first.artifact.widthDots).toBe(576);
    expect(first.artifact.paperWidthMm).toBe(80);
    expect(first.artifact.heightDots).toBeGreaterThan(2_531);
    expect(first.artifact.payload.subarray(0, 10)).toEqual(Buffer.from([
      0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x48, 0x00,
      first.artifact.heightDots & 0xff, (first.artifact.heightDots >> 8) & 0xff,
    ]));
    expect(first.artifact.payload.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x01]));
    expect(first.artifact.sha256).toBe('71f340e659233f5fab85409bf0e52312e9e457b3f2908fa772096bc86dfeee06');
    expect(second.artifact.sha256).toBe(first.artifact.sha256);
    expect(second.artifact.payload).toEqual(first.artifact.payload);
    expect(second.layout.layoutFingerprint).toBe(first.layout.layoutFingerprint);
    expect(first.layout).toEqual(expect.objectContaining({
      layoutVersion: TABLE_BILL_LAYOUT_VERSION,
      widthDots: 576,
      threshold: CANONICAL_THRESHOLD,
      dotsPerMm: CANONICAL_DOTS_PER_MM,
      verticalDpi: CANONICAL_VERTICAL_DPI,
      dishFontWeight: TABLE_BILL_DISH_FONT_WEIGHT,
      finalReceivableFontWeight: TABLE_BILL_FINAL_RECEIVABLE_FONT_WEIGHT,
      bottomSafeMm: TABLE_BILL_BOTTOM_SAFE_MM,
      bottomSafeDots: TABLE_BILL_BOTTOM_SAFE_DOTS,
      bottomBlankAreaIsRaster: true,
      bottomBlankBlackPixelCount: 0,
      visibleTextClippingCount: 0,
      textOverlapCount: 0,
      textTouchingBorderCount: 0,
      ellipsisBusinessTextCount: 0,
      qtyAmountSingleOccurrence: true,
      itemRowBottomDots: TABLE_BILL_ITEM_ROW_BOTTOM_DOTS,
      orderInfoRowGapDots: TABLE_BILL_ORDER_INFO_ROW_GAP_DOTS,
      totalsRowGapDots: TABLE_BILL_TOTAL_ROW_GAP_DOTS,
      finalTotalBottomDots: TABLE_BILL_FINAL_TOTAL_BOTTOM_DOTS,
    }));
    expect(first.layout.maxDishLineCount).toBeGreaterThanOrEqual(3);
    expect(first.layout.dishTextBlackPixelRatioAfter).toBeGreaterThan(
      first.layout.dishTextBlackPixelRatioBefore,
    );
    expect(first.layout.dishTextBlackPixelRatioAfter).toBeLessThan(
      first.layout.dishTextBoldReferenceBlackPixelRatio,
    );
    expect(first.layout.footerLastInkY).toBeLessThan(first.layout.cutReferenceY);
    expect(first.layout.bottomBlankDots).toBeGreaterThanOrEqual(TABLE_BILL_BOTTOM_SAFE_DOTS);
    expect(first.layout.bottomBlankMm).toBeGreaterThanOrEqual(23);
    expect(first.layout.bottomBlankMm).toBeLessThanOrEqual(27);
    expect(first.artifact.font).toEqual({
      family: CANONICAL_FONT_FAMILY,
      package: CANONICAL_FONT_PACKAGE,
      license: CANONICAL_FONT_LICENSE,
    });
    expect(first.layout.keyBboxes).toEqual({
      HEADER: { x: 30, y: 18, width: 516, height: 159.5 },
      CHECKOUT: { x: 30, y: 193, width: 474.8249969482422, height: 83 },
      ORDER_INFO: { x: 30, y: 290, width: 516, height: 213.5 },
      ITEMS: { x: 30, y: 513, width: 516, height: 1594.5 },
      TOTALS: { x: 30, y: 2125, width: 516, height: 168 },
      FOOTER: { x: 79, y: 2325, width: 418, height: 61 },
    });
  });

  it('keeps the anonymous golden fixture complete and free of production identifiers', () => {
    const fixture = canonicalTableBillGoldenFixture();

    expect(fixture.merchant).toEqual(expect.objectContaining({
      name: expect.any(String),
      nameVi: expect.any(String),
      address: expect.any(String),
      phone: expect.any(String),
    }));
    expect(fixture.tableSession).toEqual(expect.objectContaining({
      tableName: 'A01',
      sessionNo: expect.stringContaining('ANON'),
      openedAt: expect.any(String),
      closedAt: expect.any(String),
      orderNos: expect.arrayContaining([expect.stringContaining('ANON')]),
    }));
    expect(fixture.items).toHaveLength(14);
    expect(fixture.items.some((item) => item.name.length > 20)).toBe(true);
    expect(fixture.items.some((item) => (item.nameVi?.length ?? 0) > 60)).toBe(true);
    const glyphCoverage = fixture.items
      .flatMap((item) => [item.name, item.nameVi ?? ''])
      .concat([fixture.footer?.vi ?? ''])
      .join('\n');
    for (const sample of [
      '炖牛腩',
      '土豆炖牛腩',
      '西红柿炖牛腩',
      '青椒炒肉丝',
      'Thịt bò hầm cà chua',
      'Thịt bò hầm khoai tây',
      'Cảm ơn quý khách',
    ]) {
      expect(glyphCoverage).toContain(sample);
    }
    expect(fixture.items.some(
      (item) => `${item.nameVi} ${item.name}` === 'Thịt bò hầm cà chua 西红柿炖牛腩',
    )).toBe(true);
    expect(fixture.totals).toEqual(expect.objectContaining({
      originalAmount: expect.any(Number),
      commercialDiscountAmount: expect.any(Number),
      roundingAmount: expect.any(Number),
      receivedAmount: expect.any(Number),
    }));
    expect(fixture.footer).toEqual(expect.objectContaining({
      zh: expect.any(String),
      vi: expect.any(String),
    }));
  });

  it('verifies the shared transport-only fixture used by both clients', () => {
    const fixture = JSON.parse(readFileSync(join(process.cwd(), '../../fixtures/printing/server-esc-pos-payload-v1.json'), 'utf8'));
    const payload = Buffer.from(fixture.payloadBase64, 'base64');
    expect(payload).toHaveLength(fixture.byteLength);
    expect(createHash('sha256').update(payload).digest('hex')).toBe(fixture.sha256);
  });

  it.each([1, 5, 15, 30])('renders %i dishes with bounded linear growth', (count) => {
    const started = performance.now();
    const artifact = service.render(goldenDocument(count), 'MM80');
    expect(artifact.byteLength).toBeGreaterThan(100);
    expect(artifact.heightDots).toBeLessThan(12_000);
    expect(performance.now() - started).toBeLessThan(4_000);
  });

  it('keeps long Vietnamese words and emoji graphemes without truncating the receipt', () => {
    const artifact = service.render(goldenDocument(1, 'Cơm chiên hải sản siêu đặc biệt gia đình 👨‍👩‍👧‍👦 / 超长家庭海鲜炒饭测试菜名'), 'MM80');
    expect(artifact.heightDots).toBeGreaterThan(service.render(goldenDocument(1, 'Cơm / 饭'), 'MM80').heightDots);
  });

  it('applies the TABLE_BILL layout profile to the stored schema 3 snapshot used in production', () => {
    const receipt = goldenDocument(3);
    const snapshot = renderPrintDocumentV3({
      receipt,
      paperWidth: 'MM80',
      purpose: 'FRONT_DESK',
    });
    const evidence = service.renderEvidence(snapshot, 'MM80', 'FRONT_DESK', 'TABLE_BILL');

    expect(evidence.layout.layoutVersion).toBe(TABLE_BILL_LAYOUT_VERSION);
    expect(evidence.layout.visibleTextClippingCount).toBe(0);
    expect(evidence.layout.textOverlapCount).toBe(0);
    expect(evidence.layout.bottomBlankMm).toBeGreaterThanOrEqual(23);
    expect(evidence.layout.bottomBlankMm).toBeLessThanOrEqual(27);
  });

  it('renders a legacy semantic kitchen job with the server kitchen layout', () => {
    const receipt = {
      schemaVersion: 1 as const,
      receiptType: 'ORDER_CUSTOMER' as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      merchant: { id: '4', name: '农品香', nameVi: 'Nông Phẩm Hương' },
      order: {
        id: '42', orderNo: 'A-42', orderType: 'DINE_IN' as const,
        tableName: 'A08', createdAt: '2026-08-23T00:00:00.000Z',
      },
      items: [{
        name: '酸菜鱼', nameVi: 'Cá cải chua', quantity: 2,
        unitPrice: 120_000, lineTotal: 240_000, note: '少辣',
      }],
      totals: { subtotal: 240_000, total: 240_000, currency: 'VND' as const },
    };
    const kitchen = service.render(receipt, 'MM80', 'KITCHEN');
    const customer = service.render(receipt, 'MM80', 'FRONT_DESK');
    const customerEvidence = service.renderEvidence(receipt, 'MM80', 'FRONT_DESK');

    expect(kitchen.sha256).not.toBe(customer.sha256);
    expect(kitchen.heightDots).toBeLessThan(customer.heightDots);
    expect(customer.payload.subarray(-6)).toEqual(Buffer.from([
      0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x01,
    ]));
    expect(customerEvidence.layout.layoutVersion).toBe('DEFAULT');
    expect(customerEvidence.layout.bottomSafeDots).toBe(0);
    expect(customerEvidence.layout.bottomBlankAreaIsRaster).toBe(false);
  });
});

function goldenDocument(count: number, firstName?: string) {
  const fixture = canonicalTableBillGoldenFixture();
  const items = Array.from({ length: count }, (_, index) => {
    const item = fixture.items[index % fixture.items.length];
    if (index === 0 && firstName) return { ...item, name: firstName, nameVi: undefined };
    return index < fixture.items.length
      ? item
      : { ...item, name: `${item.name} ${index + 1}` };
  });
  return { ...fixture, items };
}
