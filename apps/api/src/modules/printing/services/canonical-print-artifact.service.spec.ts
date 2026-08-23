import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CanonicalPrintArtifactService } from './canonical-print-artifact.service';
import { createPrintDocumentV3 } from './print-document-renderer';
import { PrintBlockV3 } from '../types/print-document';

describe('CanonicalPrintArtifactService', () => {
  const service = new CanonicalPrintArtifactService();

  it('renders the anonymous 14-dish 80mm golden receipt deterministically', () => {
    const first = service.render(goldenDocument(14), 'MM80');
    const second = service.render(goldenDocument(14), 'MM80');

    expect(first.widthDots).toBe(576);
    expect(first.paperWidthMm).toBe(80);
    expect(first.heightDots).toBeGreaterThan(1_500);
    expect(first.payload.subarray(0, 10)).toEqual(Buffer.from([
      0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x48, 0x00,
      first.heightDots & 0xff, (first.heightDots >> 8) & 0xff,
    ]));
    expect(first.payload.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x01]));
    expect(first.sha256).toBe('2d0fe29e7c072ad57e812ba379635e3e70262a7c1d520352fc71b0b69032ead2');
    expect(second.sha256).toBe(first.sha256);
    expect(second.payload).toEqual(first.payload);
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

    expect(kitchen.sha256).not.toBe(customer.sha256);
    expect(kitchen.heightDots).toBeLessThan(customer.heightDots);
  });
});

function goldenDocument(count: number, firstName?: string) {
  const blocks: PrintBlockV3[] = [
    { type: 'TEXT', text: '示例餐厅', align: 'CENTER', bold: true, fontSize: 'LARGE', underline: false, overflow: 'FIT' },
    { type: 'TEXT', text: 'Nhà hàng Ví dụ', align: 'CENTER', bold: false, fontSize: 'NORMAL', underline: false, overflow: 'FIT' },
    { type: 'TEXT', text: '123 Đường Mẫu, Quận 1', align: 'CENTER', bold: false, fontSize: 'SMALL', underline: false },
    { type: 'TEXT', text: '090 000 0000', align: 'CENTER', bold: false, fontSize: 'SMALL', underline: false },
    { type: 'BOXED_TITLE', boxText: 'A08', title: '结账小票 / Hóa đơn thanh toán', subtitle: '桌账 / Phiên bàn TS-ANON', boxWeight: 24, gapDots: 4, fontSize: 'NORMAL' },
    { type: 'DIVIDER' },
  ];
  for (let index = 0; index < count; index += 1) {
    blocks.push({
      type: 'COLUMNS',
      gapDots: 4,
      cells: [
        { text: index === 0 && firstName ? firstName : `Món gia đình đặc biệt số ${index + 1} / 家庭特色菜品第${index + 1}号`, weight: 72, align: 'LEFT', bold: false, fontSize: 'LARGE', overflow: 'ELLIPSIS', paddingDots: 0 },
        { text: `x${index % 3 + 1}`, weight: 10, align: 'CENTER', bold: true, fontSize: 'NORMAL', overflow: 'FIT', paddingDots: 0 },
        { text: `${28_000 + index * 1_000}`, weight: 18, align: 'RIGHT', bold: true, fontSize: 'NORMAL', overflow: 'FIT', paddingDots: 0 },
      ],
    });
    if (index < count - 1) blocks.push({ type: 'TEXT', text: '------------------------', align: 'LEFT', bold: false, fontSize: 'SMALL', underline: false });
  }
  blocks.push(
    { type: 'DIVIDER' },
    { type: 'ROW', left: '最终应收 / Phải thu', right: '588.000 VND', bold: true },
    { type: 'TEXT', text: '谢谢惠顾，欢迎再次光临', align: 'CENTER', bold: false, fontSize: 'NORMAL', underline: false },
    { type: 'TEXT', text: 'Cảm ơn quý khách, hẹn gặp lại', align: 'CENTER', bold: false, fontSize: 'NORMAL', underline: false },
  );
  return createPrintDocumentV3('MM80', blocks);
}
