import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cashierStorageKeys } from '@/config';
import {
  createOrderPrintJob,
  createPrintJobReprint,
  listCashierPrintJobs,
} from './printing';

const responseJob = {
  id: 'job-1',
  orderId: 'order-1',
  printerId: 'printer-1',
  receiptType: 'ORDER_CUSTOMER',
  source: 'MANUAL',
  status: 'PENDING',
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: '2026-07-15T00:00:00.000Z',
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cashier printing API contract', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem(cashierStorageKeys.accessToken, 'test-token');
    fetchMock.mockReset().mockResolvedValue(jsonResponse(responseJob));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('creates an order PrintJob without accepting receipt bytes from the browser', async () => {
    await createOrderPrintJob('order-1', 'printer-1', 'cashier.request-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/merchant/printing/jobs/order');
    expect(JSON.parse(String(init.body))).toEqual({
      orderId: 'order-1',
      printerId: 'printer-1',
      requestKey: 'cashier.request-1',
    });
    expect(String(init.body)).not.toMatch(/escpos|bytes|snapshot/i);
  });

  it('requires the UI to send a reason when it requests a new reprint job', async () => {
    await createPrintJobReprint('job-1', {
      reason: 'Damaged receipt',
      printerId: 'printer-1',
      requestKey: 'cashier.request-2',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/merchant/printing/jobs/job-1/reprint');
    expect(JSON.parse(String(init.body))).toEqual({
      reason: 'Damaged receipt',
      printerId: 'printer-1',
      requestKey: 'cashier.request-2',
    });
  });

  it('queries jobs within the selected order or table-session scope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await listCashierPrintJobs({ tableSessionId: 'session-1', limit: 20 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('tableSessionId=session-1');
    expect(url).toContain('limit=20');
  });
});
