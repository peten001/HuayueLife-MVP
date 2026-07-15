import { http } from './http';
import type { ApiResponse } from '@/types/api';
import type {
  MerchantTerminal,
  MerchantTerminalPayload,
  PrintJobSource,
  PrintJobStatus,
  PrintingJob,
  PrintingFeatureState,
  PrintingListEnvelope,
  PrintingPrinter,
  PrintingPrinterPayload,
  PrintingReceiptTemplate,
  PrintingReceiptTemplatePayload,
  PrintingRule,
  PrintingRulePayload,
} from '@/types/printing';

type CollectionResponse<T> = T[] | PrintingListEnvelope<T>;

function normalizeCollection<T>(value: CollectionResponse<T>): T[] {
  return Array.isArray(value) ? value : value.items;
}

export async function getPrintingFeatureState() {
  const response = await http.get<ApiResponse<PrintingFeatureState>>(
    '/merchant/printing/feature-state',
  );
  return response.data.data;
}

export async function getPrintingPrinters() {
  const response = await http.get<ApiResponse<CollectionResponse<PrintingPrinter>>>(
    '/merchant/printing/printers',
  );
  return normalizeCollection(response.data.data);
}

export async function createPrintingPrinter(payload: PrintingPrinterPayload) {
  const response = await http.post<ApiResponse<PrintingPrinter>>(
    '/merchant/printing/printers',
    payload,
  );
  return response.data.data;
}

export async function updatePrintingPrinter(
  id: string,
  payload: Partial<PrintingPrinterPayload>,
) {
  const response = await http.patch<ApiResponse<PrintingPrinter>>(
    `/merchant/printing/printers/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disablePrintingPrinter(id: string) {
  const response = await http.post<ApiResponse<PrintingPrinter>>(
    `/merchant/printing/printers/${id}/disable`,
  );
  return response.data.data;
}

export async function getPrintingTemplates() {
  const response = await http.get<ApiResponse<CollectionResponse<PrintingReceiptTemplate>>>(
    '/merchant/printing/templates',
  );
  return normalizeCollection(response.data.data);
}

export async function createPrintingTemplate(payload: PrintingReceiptTemplatePayload) {
  const response = await http.post<ApiResponse<PrintingReceiptTemplate>>(
    '/merchant/printing/templates',
    payload,
  );
  return response.data.data;
}

export async function updatePrintingTemplate(
  id: string,
  payload: Partial<PrintingReceiptTemplatePayload>,
) {
  const response = await http.patch<ApiResponse<PrintingReceiptTemplate>>(
    `/merchant/printing/templates/${id}`,
    payload,
  );
  return response.data.data;
}

export async function duplicatePrintingTemplate(id: string) {
  const response = await http.post<ApiResponse<PrintingReceiptTemplate>>(
    `/merchant/printing/templates/${id}/duplicate`,
  );
  return response.data.data;
}

export async function getPrintingRules() {
  const response = await http.get<ApiResponse<CollectionResponse<PrintingRule>>>(
    '/merchant/printing/rules',
  );
  return normalizeCollection(response.data.data);
}

export async function createPrintingRule(payload: PrintingRulePayload) {
  const response = await http.post<ApiResponse<PrintingRule>>(
    '/merchant/printing/rules',
    payload,
  );
  return response.data.data;
}

export async function updatePrintingRule(id: string, payload: Partial<PrintingRulePayload>) {
  const response = await http.patch<ApiResponse<PrintingRule>>(
    `/merchant/printing/rules/${id}`,
    payload,
  );
  return response.data.data;
}

export async function setPrintingRuleEnabled(id: string, enabled: boolean) {
  const response = await http.post<ApiResponse<PrintingRule>>(
    `/merchant/printing/rules/${id}/${enabled ? 'enable' : 'disable'}`,
  );
  return response.data.data;
}

export async function getPrintingJobs(filters: {
  status?: PrintJobStatus | '';
  source?: PrintJobSource | '';
} = {}) {
  const params = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.source ? { source: filters.source } : {}),
  };
  const response = await http.get<ApiResponse<CollectionResponse<PrintingJob>>>(
    '/merchant/printing/jobs',
    { params },
  );
  return normalizeCollection(response.data.data);
}

export async function getPrintingJob(id: string) {
  const response = await http.get<ApiResponse<PrintingJob>>(
    `/merchant/printing/jobs/${id}`,
  );
  return response.data.data;
}

export async function cancelPrintingJob(id: string) {
  const response = await http.post<ApiResponse<PrintingJob>>(
    `/merchant/printing/jobs/${id}/cancel`,
    {},
  );
  return response.data.data;
}

export async function retryPrintingJob(id: string) {
  const response = await http.post<ApiResponse<PrintingJob>>(
    `/merchant/printing/jobs/${id}/retry`,
    {},
  );
  return response.data.data;
}

export async function getMerchantTerminals() {
  const response = await http.get<ApiResponse<CollectionResponse<MerchantTerminal>>>(
    '/merchant/printing/terminals',
  );
  return normalizeCollection(response.data.data);
}

export async function createMerchantTerminal(payload: MerchantTerminalPayload) {
  const response = await http.post<ApiResponse<MerchantTerminal>>(
    '/merchant/printing/terminals',
    payload,
  );
  return response.data.data;
}

export async function updateMerchantTerminal(
  id: string,
  payload: Partial<MerchantTerminalPayload>,
) {
  const response = await http.patch<ApiResponse<MerchantTerminal>>(
    `/merchant/printing/terminals/${id}`,
    payload,
  );
  return response.data.data;
}

export async function revokeMerchantTerminal(id: string) {
  const response = await http.post<ApiResponse<MerchantTerminal>>(
    `/merchant/printing/terminals/${id}/revoke`,
  );
  return response.data.data;
}
