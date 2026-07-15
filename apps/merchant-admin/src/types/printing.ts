export type PrinterChannelType =
  | 'LOCAL_LAN_ESCPOS'
  | 'LOCAL_USB_ESCPOS'
  | 'CLOUD_FEIE'
  | 'CLOUD_XINYE'
  | 'CLOUD_GPRINTER'
  | 'BUILTIN_SUNMI'
  | 'BUILTIN_IMIN';

export type PrintingPaperWidth = 'MM58' | 'MM80';
export type PrinterPurpose = 'FRONT_DESK' | 'KITCHEN' | 'BAR' | 'LABEL';
export type PrintingReceiptType = 'ORDER_CUSTOMER' | 'TABLE_BILL';
export type ReceiptLanguageMode = 'MERCHANT_DEFAULT' | 'ZH' | 'VI' | 'EN';
export type PrintingTriggerEvent = 'ORDER_ACCEPTED' | 'ORDER_COMPLETED' | 'MANUAL';
export type PrintingOrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type PrintJobSource = 'AUTOMATIC' | 'MANUAL_REPRINT' | 'TEST';
export type PrintJobStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PRINTING'
  | 'SUCCEEDED'
  | 'RETRY_WAIT'
  | 'FAILED'
  | 'CANCELLED';
export type MerchantTerminalPlatform = 'ANDROID' | 'WEB' | 'SERVER';

export interface PrintingPrinter {
  id: string;
  merchantId?: string;
  name: string;
  channelType: PrinterChannelType;
  paperWidth: PrintingPaperWidth;
  purpose: PrinterPurpose;
  enabled: boolean;
  status: string;
  connectionConfig: Record<string, unknown>;
  capabilities?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PrintingPrinterPayload {
  name: string;
  channelType: PrinterChannelType;
  paperWidth: PrintingPaperWidth;
  purpose: PrinterPurpose;
  enabled: boolean;
  connectionConfig: Record<string, unknown>;
  capabilities?: Record<string, unknown> | null;
}

export interface PrintingReceiptTemplate {
  id: string;
  merchantId?: string | null;
  name: string;
  receiptType: PrintingReceiptType;
  paperWidth: PrintingPaperWidth;
  languageMode: ReceiptLanguageMode;
  version: number;
  definition: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrintingReceiptTemplatePayload {
  name: string;
  receiptType: PrintingReceiptType;
  paperWidth: PrintingPaperWidth;
  languageMode: ReceiptLanguageMode;
  definition: Record<string, unknown>;
  enabled: boolean;
}

export interface PrintingRule {
  id: string;
  merchantId?: string;
  name: string;
  orderType?: PrintingOrderType | null;
  triggerEvent: PrintingTriggerEvent;
  receiptType: PrintingReceiptType;
  printerId: string;
  printer?: Pick<PrintingPrinter, 'id' | 'name' | 'enabled'>;
  receiptTemplateId?: string | null;
  receiptTemplate?: Pick<PrintingReceiptTemplate, 'id' | 'name' | 'version'> | null;
  copies: number;
  autoPrint: boolean;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrintingRulePayload {
  name: string;
  orderType?: PrintingOrderType | null;
  triggerEvent: PrintingTriggerEvent;
  receiptType: PrintingReceiptType;
  printerId: string;
  receiptTemplateId?: string | null;
  copies: number;
  autoPrint: boolean;
  enabled?: boolean;
  priority: number;
}

export interface PrintingJob {
  id: string;
  merchantId?: string;
  orderId?: string | null;
  order?: { orderNo: string } | null;
  tableSessionId?: string | null;
  printerId: string;
  printer?: Pick<PrintingPrinter, 'id' | 'name'>;
  receiptTemplateId?: string | null;
  receiptTemplateVersion?: number | null;
  receiptType: PrintingReceiptType;
  triggerEvent: PrintingTriggerEvent;
  source: PrintJobSource;
  status: PrintJobStatus;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  retryBlocked?: boolean;
  requestGroupId?: string | null;
  copyIndex?: number;
  copyCount?: number;
  availableAt: string;
  claimedAt?: string | null;
  leaseExpiresAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  receiptSnapshot?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantTerminal {
  id: string;
  merchantId?: string;
  name: string;
  platform: MerchantTerminalPlatform;
  status: string;
  capabilities: Record<string, unknown>;
  appVersion?: string | null;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantTerminalPayload {
  name: string;
  platform: MerchantTerminalPlatform;
  capabilities: Record<string, unknown>;
}

export interface PrintingListEnvelope<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}
