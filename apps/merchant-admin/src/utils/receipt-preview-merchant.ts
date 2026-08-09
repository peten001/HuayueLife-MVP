export interface ReceiptPreviewMerchantSource {
  nameZh?: string | null;
  nameVi?: string | null;
  addressZh?: string | null;
  addressDetail?: string | null;
  contactPhone?: string | null;
}

export interface ReceiptPreviewMerchant {
  nameZh: string;
  nameVi: string;
  hasName: boolean;
  address: string;
  phone: string;
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
  const address = normalizedName(merchant?.addressZh)
    || normalizedName(merchant?.addressDetail);
  const phone = normalizedName(merchant?.contactPhone);

  return {
    nameZh,
    nameVi,
    hasName: Boolean(nameZh || nameVi),
    address,
    phone,
  };
}
