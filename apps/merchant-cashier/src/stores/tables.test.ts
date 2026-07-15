import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiningTable, TableSessionDetail, TableSessionSummary } from '@/types';

const apiMocks = vi.hoisted(() => ({
  listDiningTables: vi.fn(),
  listOpenTableSessions: vi.fn(),
  getTableSessionDetail: vi.fn(),
  closeTableSession: vi.fn(),
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
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
