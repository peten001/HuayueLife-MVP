import type { ArrivalReservation } from '@huayue-life/shared';
import type { TranslationKey } from '@/i18n';

export const RESERVATION_FILTERS: Array<{ value: string; key: TranslationKey }> = [
  { value: 'ACTIVE', key: 'reservations.filterActive' },
  { value: 'PENDING', key: 'reservations.filterPending' },
  { value: 'CONFIRMED', key: 'reservations.filterConfirmed' },
  { value: 'HISTORY', key: 'reservations.filterHistory' },
  { value: 'ALL', key: 'common.all' },
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
