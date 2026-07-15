import type {
  DiningTable,
  TableCardView,
  TableSessionDetail,
  TableSessionSummary,
} from '@/types';

export function buildTableCards(
  tables: readonly DiningTable[],
  sessions: readonly TableSessionSummary[],
): TableCardView[] {
  const sessionsByTable = new Map(sessions.map((session) => [session.tableId, session]));
  return tables.map((table) => {
    const currentSession = sessionsByTable.get(table.id) ?? null;
    const operationalStatus = table.status === 'DISABLED'
      ? 'DISABLED'
      : currentSession
        ? 'IN_USE'
        : 'AVAILABLE';
    return {
      ...table,
      currentSession,
      operationalStatus,
      canCloseSession:
        currentSession?.status === 'OPEN' && currentSession.unfinishedOrderCount === 0,
    };
  });
}

export function summarizeTableSessionItems(
  session: TableSessionDetail | null | undefined,
) {
  const itemsByName = new Map<string, { name: string; quantity: number; subtotalVnd: bigint }>();
  session?.orders
    .filter((order) => order.status !== 'CANCELLED')
    .flatMap((order) => order.items ?? [])
    .forEach((item) => {
      const name = item.productNameZhSnapshot?.trim() || '—';
      const current = itemsByName.get(name) ?? { name, quantity: 0, subtotalVnd: 0n };
      current.quantity += Number(item.quantity || 0);
      try {
        current.subtotalVnd += BigInt(item.subtotalVnd || 0);
      } catch {
        // Invalid legacy monetary values are ignored instead of inventing a total.
      }
      itemsByName.set(name, current);
    });
  return [...itemsByName.values()].map((item) => ({
    ...item,
    subtotalVnd: item.subtotalVnd.toString(),
  }));
}

export function canCloseTableSession(
  session: TableSessionSummary | TableSessionDetail | null | undefined,
) {
  return session?.status === 'OPEN' && session.unfinishedOrderCount === 0;
}
