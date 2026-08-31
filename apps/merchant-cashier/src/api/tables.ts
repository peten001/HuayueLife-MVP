import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type {
  DiningTable,
  TableSessionCheckoutResult,
  TableSessionDetail,
  TableSessionSummary,
  SettlementAdjustmentInput,
  PaymentMethod,
  TransferTableSessionInput,
  CheckoutTableSessionV2Input,
  DineInCanonicalState,
  ReconcileDineInCanonicalStateInput,
  ReleaseEmptyTableSessionInput,
  ProductionNotificationResult,
} from '@/types';
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

export async function checkoutTableSession(
  sessionId: string,
  paymentMethod: PaymentMethod,
  v2?: CheckoutTableSessionV2Input,
): Promise<TableSessionCheckoutResult> {
  if (isDemoSessionActive()) return demoRepository.checkoutSession(sessionId, v2);
  return requestApi<TableSessionCheckoutResult>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/cashier-checkout`,
    { method: 'POST', body: { paymentMethod, ...v2 } },
  );
}

export function getDineInCanonicalState(sessionId: string) {
  if (isDemoSessionActive()) return Promise.resolve(demoRepository.canonicalState(sessionId));
  return requestApi<DineInCanonicalState>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/canonical-state`,
  );
}

export function reconcileDineInCanonicalState(
  sessionId: string,
  input: ReconcileDineInCanonicalStateInput,
) {
  if (isDemoSessionActive()) {
    return Promise.resolve(demoRepository.reconcileCanonicalState(sessionId, input));
  }
  return requestApi<DineInCanonicalState>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/canonical-state/reconcile`,
    { method: 'POST', body: input },
  );
}

export function notifyTableSessionProduction(
  sessionId: string,
  requestKey: string,
): Promise<ProductionNotificationResult> {
  if (isDemoSessionActive()) {
    return Promise.resolve({
      notification: {
        status: 'UP_TO_DATE',
        pendingItemQuantity: 0,
        pendingOrderCount: 0,
        configuredDestinationCount: 1,
      },
      queuedItemQuantity: 0,
      queuedOrderCount: 0,
      queuedDestinationCount: 0,
      idempotentReplay: false,
    });
  }
  return requestApi<ProductionNotificationResult>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/production-notifications`,
    { method: 'POST', body: { requestKey } },
  );
}

export async function releaseEmptyTableSession(
  sessionId: string,
  input: ReleaseEmptyTableSessionInput,
) {
  if (isDemoSessionActive()) {
    return demoRepository.releaseEmptySession(sessionId, input);
  }
  const result = await requestApi<{ session: TableSessionDetail }>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/release-empty`,
    { method: 'POST', body: input },
  );
  return result.session;
}

export async function setTableSessionRounding(sessionId: string, enabled: boolean): Promise<TableSessionDetail> {
  if (isDemoSessionActive()) return demoRepository.setSessionRounding(sessionId, enabled);
  const result = await requestApi<{ session: TableSessionDetail }>(`/merchant/table-sessions/${encodeURIComponent(sessionId)}/rounding`, { method: 'POST', body: { enabled } });
  return result.session;
}

export async function setTableSessionSettlementAdjustment(
  sessionId: string,
  input: SettlementAdjustmentInput,
): Promise<TableSessionDetail> {
  if (isDemoSessionActive()) {
    return demoRepository.setSessionSettlementAdjustment(sessionId, input);
  }
  const result = await requestApi<{ session: TableSessionDetail }>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/settlement-adjustment`,
    { method: 'POST', body: input },
  );
  return result.session;
}

export async function transferTableSession(
  sessionId: string,
  input: TransferTableSessionInput,
): Promise<TableSessionDetail> {
  if (isDemoSessionActive()) return demoRepository.transferSession(sessionId, input);
  const result = await requestApi<{ session: TableSessionDetail }>(
    `/merchant/table-sessions/${encodeURIComponent(sessionId)}/transfer`,
    { method: 'POST', body: input },
  );
  return result.session;
}
