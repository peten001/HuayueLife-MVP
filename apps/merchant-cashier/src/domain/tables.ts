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
      : !currentSession
        ? 'AVAILABLE'
        : currentSession.unfinishedOrderCount > 0
          ? 'IN_USE'
          : 'READY_TO_CLOSE';
    return {
      ...table,
      currentSession,
      operationalStatus,
      canCloseSession:
        currentSession?.status === 'OPEN' && currentSession.unfinishedOrderCount === 0,
    };
  });
}

export function canCloseTableSession(
  session: TableSessionSummary | TableSessionDetail | null | undefined,
) {
  return session?.status === 'OPEN' && session.unfinishedOrderCount === 0;
}
