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
export type PrintJobSource = 'AUTOMATIC' | 'MANUAL' | 'MANUAL_REPRINT' | 'TEST';
export type PrintJobStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PRINTING'
  | 'SUCCEEDED'
  | 'RETRY_WAIT'
  | 'FAILED'
  | 'CANCELLED';
export type MerchantTerminalPlatform = 'ANDROID' | 'WEB' | 'SERVER';

export interface PrintingFeatureState {
  taskCenterEnabled: boolean;
  automaticCreationEnabled: boolean;
  executionEnabled: boolean;
  legacyPrintingEnabled: boolean;
  merchantPrintingEnabled: boolean;
  executionState: 'CONNECTOR_PENDING' | 'READY_FOR_CONNECTOR';
}

export interface MerchantPrintingSettings {
  id: string;
  printingEnabled: boolean;
  featureFlags: Omit<PrintingFeatureState, 'merchantPrintingEnabled'>;
}

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
  readiness?: {
    state: 'READY' | 'DEVICE_OFFLINE' | 'NOT_CONFIGURED';
    channelImplemented: boolean;
    configValid: boolean;
    statusReady: boolean;
    executionEvidenceReady?: boolean;
    evidenceUpdatedAt?: string | null;
    evidenceTtlMs?: number;
  };
  adapterStatus?: string;
  executionState?: string;
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

export type MerchantTerminalStatus = 'UNPAIRED' | 'ACTIVE' | 'DISABLED' | 'REVOKED';
export type MerchantTerminalOnlineState = 'ONLINE' | 'OFFLINE';

export interface MerchantTerminalBoundPrinter {
  id: string;
  name: string;
  channelType: PrinterChannelType;
  paperWidth: PrintingPaperWidth;
  enabled: boolean;
  status: string;
  capabilities?: Record<string, unknown> | null;
}

export interface MerchantTerminalAttemptSummary {
  id: string;
  jobId: string;
  attemptNo: number;
  startedAt: string;
  finishedAt?: string | null;
  result?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  bytesWritten?: number | null;
}

export interface MerchantTerminal {
  id: string;
  merchantId?: string;
  boundPrinterId?: string | null;
  boundPrinter?: MerchantTerminalBoundPrinter | null;
  name: string;
  platform: MerchantTerminalPlatform;
  status: MerchantTerminalStatus;
  pairingState?: 'NOT_PAIRED' | MerchantTerminalStatus;
  onlineState?: MerchantTerminalOnlineState;
  capabilities: Record<string, unknown>;
  deviceIdentifier?: string | null;
  appVersion?: string | null;
  lastSeenAt?: string | null;
  pairedAt?: string | null;
  pairingExpiresAt?: string | null;
  tokenExpiresAt?: string | null;
  configVersion?: number;
  resetUsbRequestedAt?: string | null;
  resetUsbAcknowledgedAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  revokedAt?: string | null;
  attempts?: MerchantTerminalAttemptSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface MerchantTerminalPayload {
  name: string;
  platform: MerchantTerminalPlatform;
  capabilities?: Record<string, unknown>;
  boundPrinterId?: string | null;
}

export interface TerminalPairingCodeResult {
  terminal: MerchantTerminal;
  pairing: {
    pairingId: string;
    pairingCode: string;
    pairingPayload: string;
    expiresAt: string;
    maxAttempts: number;
  };
}

export interface PrintingListEnvelope<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}
