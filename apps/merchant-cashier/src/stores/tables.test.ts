import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiningTable, TableSessionDetail, TableSessionSummary } from '@/types';

const apiMocks = vi.hoisted(() => ({
  listDiningTables: vi.fn(),
  listOpenTableSessions: vi.fn(),
  getTableSessionDetail: vi.fn(),
  closeTableSession: vi.fn(),
  checkoutTableSession: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import { useTablesStore } from './tables';

const table: DiningTable = {
  id: 'table-1',
  merchantId: 'merchant-1',
  tableNo: 'A01',
  tableName: 'Window',
  qrToken: 'table-test-token',
  qrVersion: 1,
  status: 'ACTIVE',
};

const summary: TableSessionSummary = {
  id: 'session-1',
  sessionNo: 'SESSION-1',
  merchantId: 'merchant-1',
  tableId: 'table-1',
  tableNo: 'A01',
  tableName: 'Window',
  status: 'OPEN',
  openedAt: '2026-07-15T00:00:00.000Z',
  closedAt: null,
  orderCount: 1,
  itemCount: 1,
  totalAmountVnd: '50000',
  latestOrderAt: '2026-07-15T00:05:00.000Z',
  pendingOrderCount: 0,
  unfinishedOrderCount: 1,
};

const detail: TableSessionDetail = {
  ...summary,
  orders: [],
};

describe('cashier table store real-session refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.listDiningTables.mockReset().mockResolvedValue([table]);
    apiMocks.listOpenTableSessions.mockReset().mockResolvedValue([summary]);
    apiMocks.getTableSessionDetail.mockReset().mockResolvedValue(detail);
    apiMocks.closeTableSession.mockReset();
    apiMocks.checkoutTableSession.mockReset();
  });

  it('refreshes the selected TableSession without dropping the selection', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('50000');

    apiMocks.getTableSessionDetail.mockResolvedValueOnce({
      ...detail,
      totalAmountVnd: '75000',
    });
    await store.fetchTables();

    expect(store.selectedTableId).toBe(table.id);
    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('75000');
  });

  it('keeps the last successful detail visible during a background refresh and on failure', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    const deferred = createDeferred<TableSessionDetail>();
    apiMocks.getTableSessionDetail.mockReturnValueOnce(deferred.promise);

    const refresh = store.fetchTables();
    await Promise.resolve();
    expect(store.selectedSessionDetail).toEqual(detail);
    expect(store.detailLoading).toBe(false);
    deferred.reject(new Error('temporary polling failure'));
    await refresh;

    expect(store.selectedTableId).toBe(table.id);
    expect(store.selectedSessionDetail).toEqual(detail);
    expect(store.detailLoading).toBe(false);
  });

  it('keeps the table selected but clears a session closed by another terminal', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);

    apiMocks.listOpenTableSessions.mockResolvedValueOnce([]);
    await store.fetchTables();

    expect(store.selectedTableId).toBe(table.id);
    expect(store.selectedTable?.operationalStatus).toBe('AVAILABLE');
    expect(store.selectedSessionDetail).toBeNull();
  });

  it('clears the selection only when the table no longer exists', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);

    apiMocks.listDiningTables.mockResolvedValueOnce([]);
    apiMocks.listOpenTableSessions.mockResolvedValueOnce([]);
    await store.fetchTables();

    expect(store.selectedTableId).toBe('');
    expect(store.selectedSessionDetail).toBeNull();
  });

  it('does not restore previous-merchant tables after the store is cleared', async () => {
    const deferred = createDeferred<DiningTable[]>();
    apiMocks.listDiningTables.mockReturnValueOnce(deferred.promise);
    const store = useTablesStore();

    const request = store.fetchTables();
    store.clear();
    deferred.resolve([table]);
    await request;

    expect(store.tables).toEqual([]);
    expect(store.openSessions).toEqual([]);
  });

  it('applies the latest dynamic bill returned by an item mutation', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);

    store.applySessionSnapshot({ ...detail, itemCount: 2, totalAmountVnd: '75000' });

    expect(store.selectedSessionDetail?.itemCount).toBe(2);
    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('75000');
    expect(store.openSessions[0]?.totalAmountVnd).toBe('75000');
  });

  it('keeps the table selected and shows it as available after an item mutation closes the session', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);

    store.applySessionSnapshot({
      ...detail,
      status: 'CLOSED',
      closedAt: '2026-07-29T06:00:00.000Z',
      orderCount: 0,
      itemCount: 0,
      totalAmountVnd: '0',
      originalAmountVnd: '0',
      payableAmountVnd: '0',
      unfinishedOrderCount: 0,
    });

    expect(store.selectedTableId).toBe(table.id);
    expect(store.selectedSessionDetail).toBeNull();
    expect(store.openSessions).toEqual([]);
    expect(store.selectedTable?.operationalStatus).toBe('AVAILABLE');
  });

  it('does not let an older polling response overwrite a session snapshot', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);

    const staleSessions = createDeferred<TableSessionSummary[]>();
    apiMocks.listOpenTableSessions.mockReturnValueOnce(staleSessions.promise);
    const staleRequest = store.fetchTables();

    store.applySessionSnapshot({ ...detail, itemCount: 2, totalAmountVnd: '75000' });
    staleSessions.resolve([summary]);
    await staleRequest;

    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('75000');
    expect(store.openSessions[0]?.totalAmountVnd).toBe('75000');
    expect(store.detailLoading).toBe(false);
  });

  it('force refresh bypasses an in-flight request and only applies the newest revision', async () => {
    const staleSessions = createDeferred<TableSessionSummary[]>();
    const refreshedSummary = { ...summary, itemCount: 2, totalAmountVnd: '75000' };
    apiMocks.listOpenTableSessions
      .mockReturnValueOnce(staleSessions.promise)
      .mockResolvedValueOnce([refreshedSummary]);
    const store = useTablesStore();

    const staleRequest = store.fetchTables();
    const forcedRequest = store.fetchTables({ force: true });
    await forcedRequest;
    staleSessions.resolve([summary]);
    await staleRequest;

    expect(apiMocks.listDiningTables).toHaveBeenCalledTimes(2);
    expect(apiMocks.listOpenTableSessions).toHaveBeenCalledTimes(2);
    expect(store.openSessions[0]?.totalAmountVnd).toBe('75000');
    expect(store.loading).toBe(false);
  });

  it('checks out an accepted table session and removes it from the open-session list', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    const closed = { ...detail, status: 'CLOSED' as const, closedAt: '2026-07-15T01:00:00.000Z', unfinishedOrderCount: 0 };
    apiMocks.checkoutTableSession.mockResolvedValueOnce({ session: closed, orders: [] });
    apiMocks.listOpenTableSessions.mockResolvedValueOnce([]);

    await expect(store.checkoutSelectedSession()).resolves.toEqual({ session: closed, orders: [] });

    expect(apiMocks.checkoutTableSession).toHaveBeenCalledWith(detail.id);
    expect(store.openSessions).toEqual([]);
    expect(store.selectedTable?.operationalStatus).toBe('AVAILABLE');
  });

  it('blocks checkout locally while any order is still awaiting acceptance', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    apiMocks.getTableSessionDetail.mockResolvedValueOnce({ ...detail, pendingOrderCount: 1 });
    await store.selectTable(table.id);

    await expect(store.checkoutSelectedSession()).rejects.toThrow('unaccepted');
    expect(apiMocks.checkoutTableSession).not.toHaveBeenCalled();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
