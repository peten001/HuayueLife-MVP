import { PrinterChannelType } from '@prisma/client';
import { ReceiptDocument } from './receipt-document';

/**
 * RC5 and RC6 both advertise receipt schemaVersion 1. RC6 extended that
 * schema with footer and merchant.nameVi, while RC5 rejects those fields.
 * Until a connector reports a reliable feature profile, USB must use the
 * strict RC5 subset. Server-side cloud and LAN renderers retain the current
 * document.
 */
export const RC5_RECEIPT_SCHEMA_VERSION = 1 as const;
export const RC6_RECEIPT_SCHEMA_VERSION = 1 as const;

export function receiptDocumentForChannel(
  document: ReceiptDocument,
  channelType: PrinterChannelType,
): ReceiptDocument {
  if (channelType !== 'LOCAL_USB_ESCPOS') return document;
  return toRc5CompatibleReceipt(document);
}

export function toRc5CompatibleReceipt(
  document: ReceiptDocument,
): ReceiptDocument {
  const { footer: _footer, ...receipt } = document;
  const { nameVi: _merchantNameVi, ...merchant } = document.merchant;
  return {
    ...receipt,
    schemaVersion: RC5_RECEIPT_SCHEMA_VERSION,
    merchant,
  };
}
