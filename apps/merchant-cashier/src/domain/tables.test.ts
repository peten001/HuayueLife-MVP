import { describe, expect, it } from 'vitest';
import type { DiningTable, TableSessionDetail, TableSessionSummary } from '@/types';
import { buildTableCards, canCloseTableSession, summarizeTableSessionItems } from './tables';

function table(id: string, status: DiningTable['status'] = 'ACTIVE'): DiningTable {
  return {
    id,
    merchantId: 'merchant-1',
    tableNo: id.toUpperCase(),
    qrToken: `token-${id}`,
    qrVersion: 1,
    status,
  };
}

function session(
  tableId: string,
  overrides: Partial<TableSessionSummary> = {},
): TableSessionSummary {
  return {
    id: `session-${tableId}`,
    sessionNo: `SESSION-${tableId}`,
    merchantId: 'merchant-1',
    tableId,
    tableNo: tableId.toUpperCase(),
    status: 'OPEN',
    openedAt: '2026-07-14T00:00:00.000Z',
    orderCount: 1,
    itemCount: 2,
    totalAmountVnd: '120000',
    latestOrderAt: '2026-07-14T00:05:00.000Z',
    pendingOrderCount: 0,
    unfinishedOrderCount: 1,
    ...overrides,
  };
}

describe('table card derivation', () => {
  it('derives only the table states that exist in the real API', () => {
    const tables = [
      table('available'),
      table('in-use'),
      table('ready'),
      table('disabled', 'DISABLED'),
    ];
    const cards = buildTableCards(tables, [
      session('in-use', { unfinishedOrderCount: 2 }),
      session('ready', { unfinishedOrderCount: 0 }),
    ]);

    expect(cards.map(({ id, operationalStatus, canCloseSession }) => ({
      id,
      operationalStatus,
      canCloseSession,
    }))).toEqual([
      { id: 'available', operationalStatus: 'AVAILABLE', canCloseSession: false },
      { id: 'in-use', operationalStatus: 'IN_USE', canCloseSession: false },
      { id: 'ready', operationalStatus: 'IN_USE', canCloseSession: true },
      { id: 'disabled', operationalStatus: 'DISABLED', canCloseSession: false },
    ]);
  });

  it('keeps the matching open session on its table card', () => {
    const currentSession = session('a01');
    const [card] = buildTableCards([table('a01')], [currentSession]);

    expect(card.currentSession).toBe(currentSession);
    expect(card.currentSession?.tableId).toBe('a01');
  });
});

describe('table session item summary', () => {
  it('aggregates billable items and excludes cancelled orders', () => {
    const detail: TableSessionDetail = {
      ...session('a01', { unfinishedOrderCount: 0, orderCount: 2 }),
      orders: [
        {
          id: 'order-1',
          orderNo: 'O-1',
          status: 'COMPLETED',
          createdAt: '2026-07-14T00:00:00.000Z',
          itemAmountVnd: '90000',
          deliveryFeeVnd: '0',
          totalAmountVnd: '90000',
          items: [
            { id: 'i-1', productNameZhSnapshot: '牛肉粉', quantity: 1, unitPriceVnd: '45000', subtotalVnd: '45000' },
            { id: 'i-2', productNameZhSnapshot: '牛肉粉', quantity: 1, unitPriceVnd: '45000', subtotalVnd: '45000' },
          ],
        },
        {
          id: 'order-2',
          orderNo: 'O-2',
          status: 'CANCELLED',
          createdAt: '2026-07-14T00:01:00.000Z',
          itemAmountVnd: '30000',
          deliveryFeeVnd: '0',
          totalAmountVnd: '30000',
          items: [
            { id: 'i-3', productNameZhSnapshot: '咖啡', quantity: 1, unitPriceVnd: '30000', subtotalVnd: '30000' },
          ],
        },
      ],
    };

    expect(summarizeTableSessionItems(detail)).toEqual([
      { name: '牛肉粉', quantity: 2, subtotalVnd: '90000' },
    ]);
  });
});

describe('table session closing conditions', () => {
  it('allows closing only an open session with no unfinished orders', () => {
    expect(canCloseTableSession(session('a01', { status: 'OPEN', unfinishedOrderCount: 0 })))
      .toBe(true);
    expect(canCloseTableSession(session('a01', { status: 'OPEN', unfinishedOrderCount: 1 })))
      .toBe(false);
    expect(canCloseTableSession(session('a01', { status: 'CLOSED', unfinishedOrderCount: 0 })))
      .toBe(false);
    expect(canCloseTableSession(null)).toBe(false);
    expect(canCloseTableSession(undefined)).toBe(false);
  });

  it('does not confuse settlement with the existing close-session rule', () => {
    const completedButUnsettledSession = session('a01', {
      status: 'OPEN',
      unfinishedOrderCount: 0,
      orderCount: 2,
    });

    expect(canCloseTableSession(completedButUnsettledSession)).toBe(true);
  });
});
