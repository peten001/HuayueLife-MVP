import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiningTable, DineInCanonicalState, TableSessionDetail, TableSessionSummary } from '@/types';

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

import { TABLE_SESSION_DETAIL_TTL_MS, useTablesStore } from './tables';

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
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.listDiningTables.mockReset().mockResolvedValue([table]);
    apiMocks.listOpenTableSessions.mockReset().mockResolvedValue([summary]);
    apiMocks.getTableSessionDetail.mockReset().mockResolvedValue(detail);
    apiMocks.closeTableSession.mockReset();
    apiMocks.checkoutTableSession.mockReset();
  });

  it('refreshes the selected TableSession without dropping the selection', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('50000');

    apiMocks.getTableSessionDetail.mockResolvedValueOnce({
      ...detail,
      totalAmountVnd: '75000',
    });
    now.mockReturnValue(1_000 + TABLE_SESSION_DETAIL_TTL_MS + 1);
    await store.fetchTables();
    await Promise.resolve();

    expect(store.selectedTableId).toBe(table.id);
    expect(store.selectedSessionDetail?.totalAmountVnd).toBe('75000');
  });

  it('keeps the last successful detail visible during a background refresh and on failure', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    const deferred = createDeferred<TableSessionDetail>();
    apiMocks.getTableSessionDetail.mockReturnValueOnce(deferred.promise);
    now.mockReturnValue(1_000 + TABLE_SESSION_DETAIL_TTL_MS + 1);

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

  it('patches the table amount from canonical state immediately and rejects a stale poll', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    const staleSessions = createDeferred<TableSessionSummary[]>();
    apiMocks.listOpenTableSessions.mockReturnValueOnce(staleSessions.promise);
    const staleRequest = store.fetchTables();

    store.applyCanonicalTableSnapshot(canonical('75000', 3));
    expect(store.selectedTable?.currentSession?.totalAmountVnd).toBe('75000');
    expect(store.selectedTable?.currentSession?.itemCount).toBe(3);
    expect(store.selectedSessionDetail?.payableAmountVnd).toBe('75000');

    staleSessions.resolve([summary]);
    await staleRequest;
    expect(store.selectedTable?.currentSession?.totalAmountVnd).toBe('75000');
  });

  it('force refresh reuses an in-flight request instead of creating a duplicate first wave', async () => {
    const sessions = createDeferred<TableSessionSummary[]>();
    apiMocks.listOpenTableSessions.mockReturnValueOnce(sessions.promise);
    const store = useTablesStore();

    const firstRequest = store.fetchTables();
    const forcedRequest = store.fetchTables({ force: true });
    expect(apiMocks.listDiningTables).toHaveBeenCalledTimes(1);
    expect(apiMocks.listOpenTableSessions).toHaveBeenCalledTimes(1);
    sessions.resolve([summary]);
    await Promise.all([firstRequest, forcedRequest]);

    expect(apiMocks.listDiningTables).toHaveBeenCalledTimes(1);
    expect(apiMocks.listOpenTableSessions).toHaveBeenCalledTimes(1);
    expect(store.openSessions[0]?.totalAmountVnd).toBe('50000');
    expect(store.loading).toBe(false);
  });

  it('deduplicates session detail and reuses a fresh detail without blocking HTTP', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    const pending = createDeferred<TableSessionDetail>();
    apiMocks.getTableSessionDetail.mockReturnValueOnce(pending.promise);

    const first = store.selectTable(table.id);
    const second = store.selectTable(table.id);
    pending.resolve(detail);
    await Promise.all([first, second]);
    expect(apiMocks.getTableSessionDetail).toHaveBeenCalledTimes(1);

    await store.selectTable(table.id);
    expect(apiMocks.getTableSessionDetail).toHaveBeenCalledTimes(1);
    expect(store.selectedSessionDetail).toEqual(detail);
  });

  it('checks out an accepted table session and removes it from the open-session list', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    await store.selectTable(table.id);
    const closed = { ...detail, status: 'CLOSED' as const, closedAt: '2026-07-15T01:00:00.000Z', unfinishedOrderCount: 0 };
    apiMocks.checkoutTableSession.mockResolvedValueOnce({ session: closed, orders: [] });
    apiMocks.listOpenTableSessions.mockResolvedValueOnce([]);

    await expect(store.checkoutSelectedSession('CASH')).resolves.toEqual({ session: closed, orders: [] });

    expect(apiMocks.checkoutTableSession).toHaveBeenCalledWith(detail.id, 'CASH');
    expect(store.openSessions).toEqual([]);
    expect(store.selectedTable?.operationalStatus).toBe('AVAILABLE');
  });

  it('blocks checkout locally while any order is still awaiting acceptance', async () => {
    const store = useTablesStore();
    await store.fetchTables();
    apiMocks.getTableSessionDetail.mockResolvedValueOnce({ ...detail, pendingOrderCount: 1 });
    await store.selectTable(table.id);

    await expect(store.checkoutSelectedSession('BANK_TRANSFER')).rejects.toThrow('unaccepted');
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

function canonical(total: string, quantity: number): DineInCanonicalState {
  return {
    sessionId: summary.id,
    tableId: table.id,
    tableNo: table.tableNo,
    tableName: table.tableName,
    openedAt: summary.openedAt,
    sessionStatus: 'OPEN',
    revision: `dcs2:sha256:${'1'.repeat(64)}`,
    items: [{
      lineKey: `dline:sha256:${'2'.repeat(64)}`,
      productId: 'product-1',
      productNameZh: '牛肉粉',
      remark: '',
      optionSignature: '',
      activeSince: '2026-07-15T00:05:00.000Z',
      displayOrderKey: '2026-07-15T00:05:00.000Z:1:line',
      unitPriceVnd: (BigInt(total) / BigInt(quantity)).toString(),
      quantity,
      lockedQuantity: 0,
      adjustableQuantity: quantity,
      subtotalVnd: total,
      adjustability: 'RETURN',
      sourceSummary: { staffQuantity: quantity, qrQuantity: 0 },
    }],
    totals: {
      originalAmountVnd: total,
      discountPayableRateBps: null,
      discountAmountVnd: '0',
      roundingAmountVnd: '0',
      payableAmountVnd: total,
    },
    blockers: [],
    generatedAt: '2026-08-30T00:00:00.000Z',
  };
}
