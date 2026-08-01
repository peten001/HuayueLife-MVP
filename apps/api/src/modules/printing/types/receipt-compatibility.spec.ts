import { PrinterChannelType } from '@prisma/client';
import { ReceiptDocument } from './receipt-document';
import {
  RC5_RECEIPT_SCHEMA_VERSION,
  RC6_RECEIPT_SCHEMA_VERSION,
  receiptDocumentForChannel,
} from './receipt-compatibility';

const currentReceipt: ReceiptDocument = {
  schemaVersion: 1,
  receiptType: 'TABLE_BILL',
  generatedAt: '2026-07-29T00:00:00.000Z',
  merchant: { id: '4', name: '测试商家', nameVi: 'Nhà hàng thử nghiệm' },
  tableSession: {
    id: '117',
    sessionNo: 'TS117',
    tableName: 'A07',
    openedAt: '2026-07-29T00:00:00.000Z',
    orderNos: ['ORDER-117'],
  },
  items: [
    {
      name: '测试菜品',
      nameVi: 'Món thử nghiệm',
      quantity: 1,
      unitPrice: 513_000,
      lineTotal: 513_000,
    },
  ],
  totals: {
    subtotal: 513_000,
    originalAmount: 513_000,
    discount: 3_000,
    roundingAmount: 3_000,
    receivedAmount: 510_000,
    total: 510_000,
    currency: 'VND',
  },
  footer: { zh: '谢谢惠顾', vi: 'Cảm ơn quý khách' },
};

describe('receipt schema compatibility', () => {
  it('uses the strict RC5 subset for every USB job when no reliable terminal profile exists', () => {
    const compatible = receiptDocumentForChannel(
      currentReceipt,
      'LOCAL_USB_ESCPOS',
    );

    expect(RC5_RECEIPT_SCHEMA_VERSION).toBe(1);
    expect(compatible.schemaVersion).toBe(1);
    expect(compatible).not.toHaveProperty('footer');
    expect(compatible.merchant).not.toHaveProperty('nameVi');
    expect(compatible.items[0].nameVi).toBe('Món thử nghiệm');
  });

  it('preserves settlement amounts while changing only the USB receipt shape', () => {
    const compatible = receiptDocumentForChannel(
      currentReceipt,
      'LOCAL_USB_ESCPOS',
    );

    expect(compatible.totals).toEqual(
      expect.objectContaining({
        originalAmount: 513_000,
        roundingAmount: 3_000,
        receivedAmount: 510_000,
        total: 510_000,
      }),
    );
  });

  it.each([
    'CLOUD_FEIE',
    'CLOUD_YILIAN',
    'LOCAL_LAN_ESCPOS',
    'LOCAL_BLUETOOTH_ESCPOS',
  ] as PrinterChannelType[])(
    'leaves %s on the current RC6-compatible document',
    (channelType) => {
      expect(RC6_RECEIPT_SCHEMA_VERSION).toBe(1);
      expect(receiptDocumentForChannel(currentReceipt, channelType)).toBe(
        currentReceipt,
      );
    },
  );
});
