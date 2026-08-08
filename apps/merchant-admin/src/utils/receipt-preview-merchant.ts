export interface ReceiptPreviewMerchantSource {
  nameZh?: string | null;
  nameVi?: string | null;
}

export interface ReceiptPreviewMerchant {
  nameZh: string;
  nameVi: string;
  hasName: boolean;
}

function normalizedName(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

export function receiptPreviewMerchant(
  merchant: ReceiptPreviewMerchantSource | null | undefined,
): ReceiptPreviewMerchant {
  const nameZh = normalizedName(merchant?.nameZh);
  const normalizedNameVi = normalizedName(merchant?.nameVi);
  const nameVi = normalizedNameVi === nameZh ? '' : normalizedNameVi;

  return {
    nameZh,
    nameVi,
    hasName: Boolean(nameZh || nameVi),
  };
}
