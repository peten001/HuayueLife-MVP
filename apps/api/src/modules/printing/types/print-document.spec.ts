import { assertPrintDocumentV2 } from './print-document';

describe('PrintDocument V2 schema', () => {
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
});
