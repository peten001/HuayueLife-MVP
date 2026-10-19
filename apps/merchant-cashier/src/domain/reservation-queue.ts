import type { ArrivalReservation, ReservationTextKey } from '@huayue-life/shared';

export const RESERVATION_FILTERS: Array<{ value: string; key: ReservationTextKey }> = [
  { value: 'ACTIVE', key: 'active' },
  { value: 'PENDING', key: 'PENDING' },
  { value: 'CONFIRMED', key: 'CONFIRMED' },
  { value: 'HISTORY', key: 'history' },
  { value: 'ALL', key: 'all' },
];

export function reservationMatchesFilter(row: ArrivalReservation, filter: string) {
  const ended = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(row.status);
  return filter === 'ALL' || (filter === 'ACTIVE' ? !ended : filter === 'HISTORY' ? ended : row.status === filter);
}

// A planned table is a reception note, never a live table session or occupancy.
export function reservationsByTable(rows: ArrivalReservation[]): Record<string, ArrivalReservation[]> {
  const result: Record<string, ArrivalReservation[]> = {};
  for (const row of rows) {
    if (row.kind !== 'DINE_IN' || row.status !== 'CONFIRMED' || !row.assignedTable?.id) continue;
    (result[row.assignedTable.id] ??= []).push(row);
  }
  for (const reservations of Object.values(result)) {
    reservations.sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '') || a.id.localeCompare(b.id));
  }
  return result;
}
