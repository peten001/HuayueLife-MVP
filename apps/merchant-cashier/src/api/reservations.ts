import type { ArrivalKind, ArrivalReservation } from '@huayue-life/shared';
import { requestApi } from './http';
import { isDemoSessionActive } from '@/fixtures';

export interface ReservationAction {
  action: 'CONFIRM' | 'CANCEL' | 'NO_SHOW' | 'SEAT' | 'PROPOSE_TIME' | 'ASSIGN_TABLE';
  tableId?: string;
  scheduledFor?: string;
  reason?: string;
}
export function listReservations() {
  if (isDemoSessionActive()) return Promise.resolve({ reservations: [] as ArrivalReservation[], serverTime: new Date().toISOString() });
  return requestApi<{ reservations: ArrivalReservation[]; serverTime: string }>('/merchant/reservations');
}
export function updateReservation(kind: ArrivalKind, id: string, body: ReservationAction) {
  return requestApi<ArrivalReservation>(`/merchant/reservations/${kind}/${encodeURIComponent(id)}/actions`, { method: 'POST', body });
}
