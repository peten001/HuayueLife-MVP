import type {
  CashierPrintJob,
  CashierPrintingFeatureState,
  CashierPrintingPrinter,
} from '@/types';
import { requestApi } from './http';

export function getCashierPrintingFeatureState() {
  return requestApi<CashierPrintingFeatureState>('/merchant/printing/feature-state');
}

export function listCashierPrintingPrinters() {
  return requestApi<CashierPrintingPrinter[]>('/merchant/printing/printers');
}

export function listCashierPrintJobs(filters: {
  orderId?: string;
  tableSessionId?: string;
  limit?: number;
}) {
  return requestApi<CashierPrintJob[]>('/merchant/printing/jobs', { query: filters });
}

export function createOrderPrintJob(orderId: string, printerId: string, requestKey: string) {
  return requestApi<CashierPrintJob>('/merchant/printing/jobs/order', {
    method: 'POST',
    body: { orderId, printerId, requestKey },
  });
}

export function createTableBillPrintJob(
  tableSessionId: string,
  printerId: string,
  requestKey: string,
) {
  return requestApi<CashierPrintJob>('/merchant/printing/jobs/table-bill', {
    method: 'POST',
    body: { tableSessionId, printerId, requestKey },
  });
}

export function createPrintJobReprint(
  jobId: string,
  payload: { reason: string; printerId?: string; requestKey: string },
) {
  return requestApi<CashierPrintJob>(
    `/merchant/printing/jobs/${encodeURIComponent(jobId)}/reprint`,
    { method: 'POST', body: payload },
  );
}
