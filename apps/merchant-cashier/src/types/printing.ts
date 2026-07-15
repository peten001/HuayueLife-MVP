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
  merchantPrintingEnabled: boolean;
  executionState: 'CONNECTOR_PENDING' | 'READY_FOR_CONNECTOR';
}

export interface CashierPrintingPrinter {
  id: string;
  name: string;
  channelType: string;
  paperWidth: 'MM58' | 'MM80';
  enabled: boolean;
  status: 'UNVERIFIED' | 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';
  connectionConfig: Record<string, unknown>;
  capabilities?: Record<string, unknown> | null;
  readiness?: {
    state: 'READY' | 'DEVICE_OFFLINE' | 'NOT_CONFIGURED';
    channelImplemented: boolean;
    configValid: boolean;
    statusReady: boolean;
  };
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
  | 'NOT_ENABLED'
  | 'NOT_CONFIGURED'
  | 'DEVICE_OFFLINE';
