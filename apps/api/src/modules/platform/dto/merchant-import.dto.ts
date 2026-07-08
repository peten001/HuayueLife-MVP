export type MerchantImportStatus = 'VALID' | 'WARNING' | 'ERROR';
export type MerchantImportSourceType = 'XLSX' | 'ZIP';
export type MerchantImportBusinessHours = Record<string, string[]>;

export interface MerchantImportNormalizedRow {
  nameZh: string;
  nameVi: string;
  nameEn: string;
  businessTypeCode: string;
  contactPhone: string;
  contactName: string;
  province: string;
  addressZh: string;
  latitude: number | null;
  longitude: number | null;
  coverPath: string;
  openingHoursText: string;
  businessHours: MerchantImportBusinessHours;
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
  sessionId: string;
  sourceType: MerchantImportSourceType;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: MerchantImportPreviewRow[];
}

export interface MerchantImportConfirmRequest {
  sessionId: string;
  rowNumbers?: number[];
}

export interface MerchantImportConfirmResult {
  totalRows: number;
  importedCount: number;
  failedCount: number;
  imageUploadSuccessCount: number;
  imageUploadFailureCount: number;
  failedRows: Array<{
    rowNumber: number;
    errors: string[];
  }>;
  createdMerchantIds: string[];
}
