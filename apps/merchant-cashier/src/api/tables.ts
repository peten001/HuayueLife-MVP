import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type { DiningTable, TableSessionDetail, TableSessionSummary } from '@/types';
import { requestApi } from './http';

export function listDiningTables(): Promise<DiningTable[]> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.tables())
    : requestApi<DiningTable[]>('/merchant/tables');
}

export async function listOpenTableSessions(): Promise<TableSessionSummary[]> {
  if (isDemoSessionActive()) return demoRepository.openSessions();
  const result = await requestApi<{ sessions: TableSessionSummary[] }>('/merchant/table-sessions/open');
  return result.sessions;
}

export async function getCurrentTableSession(tableId: string): Promise<TableSessionSummary | null> {
  if (isDemoSessionActive()) return demoRepository.currentSession(tableId);
  const result = await requestApi<{ session: TableSessionSummary | null }>(
    `/merchant/tables/${encodeURIComponent(tableId)}/current-session`,
  );
  return result.session;
}

export async function getTableSessionDetail(sessionId: string): Promise<TableSessionDetail> {
  if (isDemoSessionActive()) return demoRepository.session(sessionId);
  const result = await requestApi<{ session: TableSessionDetail }>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}`,
  );
  return result.session;
}

export async function closeTableSession(sessionId: string): Promise<TableSessionDetail> {
  if (isDemoSessionActive()) return demoRepository.closeSession(sessionId);
  const result = await requestApi<{ session: TableSessionDetail }>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/close`,
    { method: 'POST', body: {} },
  );
  return result.session;
}
