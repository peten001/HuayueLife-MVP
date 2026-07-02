export type MerchantImportStatus = 'VALID' | 'WARNING' | 'ERROR';

export interface MerchantImportNormalizedRow {
  nameZh: string;
  nameVi: string;
  nameEn: string;
  businessTypeCode: string;
  contactPhone: string;
  contactName: string;
  province: string;
  city?: string | null;
  district?: string | null;
  addressZh: string;
  addressVi?: string | null;
  addressEn?: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHoursText?: string | null;
  descriptionZh?: string | null;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  logoUrl?: string | null;
  coverUrl: string;
  promotionTagCodes: string[];
  isNew: boolean;
  sortOrder: number;
  isVisibleOnClient: boolean;
  status: 'DRAFT' | 'ACTIVE';
}

export interface MerchantImportPreviewRow {
  rowNumber: number;
  rawData: Record<string, string>;
  normalizedData: MerchantImportNormalizedRow | null;
  errors: string[];
  warnings: string[];
  status: MerchantImportStatus;
}

export interface MerchantImportPreviewResponse {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: MerchantImportPreviewRow[];
}

export interface MerchantImportConfirmRequest {
  rows: MerchantImportPreviewRow[];
}

export interface MerchantImportConfirmResult {
  importedCount: number;
  failedCount: number;
  failedRows: Array<{
    rowNumber: number;
    errors: string[];
  }>;
  createdMerchantIds: string[];
}
