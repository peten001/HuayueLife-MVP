import type { ArrivalReservation } from '@huayue-life/shared';
import { request } from './http';

export interface DiningReservationRequest {
  merchantId: string;
  scheduledFor: string;
  guestCount: number;
  contactName: string;
  contactPhone: string;
  customerRemark?: string;
  withCart: boolean;
  expectedAmountVnd?: string;
}
export const createDiningReservation = (data: DiningReservationRequest, key: string) =>
  request<ArrivalReservation>('/reservations', { method: 'POST', data, header: { 'Idempotency-Key': key } });
export const getDiningReservations = () => request<ArrivalReservation[]>('/reservations');
export const getDiningReservation = (id: string) => request<ArrivalReservation>(`/reservations/${encodeURIComponent(id)}`);
export const cancelDiningReservation = (id: string) => request<ArrivalReservation>(`/reservations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export interface ReservationDishesRequest { cartId: string; expectedAmountVnd: string }
export const addDiningReservationDishes = (id: string, data: ReservationDishesRequest, key: string) =>
  request<ArrivalReservation>(`/reservations/${encodeURIComponent(id)}/dishes`, { method: 'POST', data, header: { 'Idempotency-Key': key } });
export const replyReservationTime = (kind: 'DINE_IN' | 'PICKUP', id: string, proposedScheduledFor: string, accept: boolean) =>
  request<ArrivalReservation>(`/reservations/${kind}/${encodeURIComponent(id)}/reply-time`, { method: 'POST', data: { proposedScheduledFor, accept } });
