export type CashierPrintJobStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PRINTING'
  | 'SUCCEEDED'
  | 'RETRY_WAIT'
  | 'FAILED'
  | 'CANCELLED';

export interface CashierPrintingFeatureState {
  taskCenterEnabled: boolean;
  automaticCreationEnabled: boolean;
  executionEnabled: boolean;
  legacyPrintingEnabled: boolean;
  merchantPrintingEnabled?: boolean;
  executionState: 'CONNECTOR_PENDING' | 'READY_FOR_CONNECTOR';
}

export interface CashierPrintingPrinter {
  id: string;
  name: string;
  channelType: string;
  paperWidth: 'MM58' | 'MM80';
  enabled: boolean;
  status: string;
}

export interface CashierMerchantTerminal {
  id: string;
  status: string;
  onlineState?: 'ONLINE' | 'OFFLINE' | 'NOT_CONNECTED';
  boundPrinterId?: string | null;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
}

export interface CashierPrintJob {
  id: string;
  orderId?: string | null;
  tableSessionId?: string | null;
  printerId: string;
  receiptType: 'ORDER_CUSTOMER' | 'TABLE_BILL';
  source: 'AUTOMATIC' | 'MANUAL' | 'MANUAL_REPRINT' | 'TEST';
  status: CashierPrintJobStatus;
  attemptCount: number;
  maxAttempts: number;
  retryBlocked?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export type CashierPrintingAvailability =
  | 'LOADING'
  | 'READY'
  | 'DISABLED'
  | 'CONFIG_REQUIRED'
  | 'TERMINAL_OFFLINE'
  | 'UNAVAILABLE';
