import type { UserOrder } from '@/types/api';
import { request } from './http';

export const getOrders = () => request<UserOrder[]>('/orders');

export const getOrder = (id: string) => request<UserOrder>(`/orders/${id}`);

export const cancelOrder = (id: string) =>
  request<UserOrder>(`/orders/${id}/cancel`, { method: 'POST' });

export const confirmReceived = (id: string) =>
  request<UserOrder>(`/orders/${id}/confirm-received`, { method: 'POST' });
