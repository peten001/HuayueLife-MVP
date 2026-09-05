import { assertPrintDocumentV2, assertPrintDocumentV3 } from './print-document';

describe('PrintDocument V2 schema', () => {
  it('validates optional server row typography without accepting invalid spacing or font sizes', () => {
    const row = { type: 'ROW', left: '总收入 / Doanh thu', right: '11.242.000 VND', bold: true };
    const document = {
      documentType: 'PRINT_DOCUMENT', schemaVersion: 2, paperWidth: 'MM80', copies: 1,
      blocks: [{ ...row, fontSize: 'LARGE', gapBeforeDots: 24 }],
    };
    expect(() => assertPrintDocumentV2(document)).not.toThrow();
    for (const style of [
      { fontSize: 'HUGE' }, { gapBeforeDots: -1 }, { gapBeforeDots: 81 },
      { gapBeforeDots: 1.5 }, { gapBeforeDots: '24' },
    ]) {
      expect(() => assertPrintDocumentV2({ ...document, blocks: [{ ...row, ...style }] }))
        .toThrow('ROW block 0 is invalid');
    }
  });

  it('accepts presentation blocks and rejects business fields', () => {
    const document = {
      documentType: 'PRINT_DOCUMENT', schemaVersion: 2, paperWidth: 'MM58', copies: 1,
      blocks: [{ type: 'ROW', left: '优惠 10%', right: '-82,800 VND', bold: false }],
    };
    expect(() => assertPrintDocumentV2(document)).not.toThrow();
    expect(() => assertPrintDocumentV2({ ...document, discountAmount: 82_800 })).toThrow(
      'Print document must be a supported object',
    );
  });

  it('accepts strict schema 3 columns and boxed titles while keeping them out of schema 2', () => {
    const blocks = [
      {
        type: 'BOXED_TITLE', boxText: 'A01', title: '结账小票/Hóa đơn thanh toán',
        subtitle: 'TS-A01', boxWeight: 24, gapDots: 10, fontSize: 'NORMAL',
      },
      {
        type: 'COLUMNS', gapDots: 8, cells: [
          { text: 'Món', weight: 48, align: 'LEFT', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
          { text: 'Đơn giá', weight: 20, align: 'RIGHT', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
          { text: 'SL', weight: 8, align: 'CENTER', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
          { text: 'Thành tiền', weight: 24, align: 'RIGHT', bold: true, fontSize: 'SMALL', overflow: 'FIT', paddingDots: 0 },
        ],
      },
    ];
    const document = {
      documentType: 'PRINT_DOCUMENT', schemaVersion: 3, paperWidth: 'MM80', copies: 1, blocks,
    };

    expect(() => assertPrintDocumentV3(document)).not.toThrow();
    expect(() => assertPrintDocumentV2({ ...document, schemaVersion: 2 })).toThrow(
      'Print block 0 type is unsupported',
    );
    expect(() => assertPrintDocumentV3({
      ...document,
      blocks: [{ ...blocks[1], cells: (blocks[1] as { cells: unknown[] }).cells.slice(0, 1) }],
    })).toThrow('COLUMNS block 0 is invalid');
  });

  it('allows measured one-line TEXT overflow only in schema 3', () => {
    const text = {
      type: 'TEXT', text: '商家中文名 / Tên nhà hàng', align: 'CENTER', bold: true,
      fontSize: 'LARGE', underline: false, overflow: 'FIT',
    };
    const root = {
      documentType: 'PRINT_DOCUMENT', paperWidth: 'MM80', copies: 1, blocks: [text],
    };

    expect(() => assertPrintDocumentV3({ ...root, schemaVersion: 3 })).not.toThrow();
    expect(() => assertPrintDocumentV2({ ...root, schemaVersion: 2 })).toThrow(
      'TEXT block 0 is invalid',
    );
  });
});
