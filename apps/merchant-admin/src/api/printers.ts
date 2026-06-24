import { http } from './http';
import type {
  ApiResponse,
  PrinterPayload,
  PrinterSetting,
} from '@/types/api';

export async function getPrinters() {
  const response = await http.get<ApiResponse<PrinterSetting[]>>(
    '/merchant/printers',
  );
  return response.data.data;
}

export async function createPrinter(payload: PrinterPayload) {
  const response = await http.post<ApiResponse<PrinterSetting>>(
    '/merchant/printers',
    payload,
  );
  return response.data.data;
}

export async function updatePrinter(id: string, payload: Partial<PrinterPayload>) {
  const response = await http.patch<ApiResponse<PrinterSetting>>(
    `/merchant/printers/${id}`,
    payload,
  );
  return response.data.data;
}

export async function deletePrinter(id: string) {
  await http.delete(`/merchant/printers/${id}`);
}

export async function testPrinter(id: string) {
  const response = await http.post<ApiResponse<{
    success: boolean;
    errorMessage?: string;
  }>>(`/merchant/printers/${id}/test`);
  return response.data.data;
}
