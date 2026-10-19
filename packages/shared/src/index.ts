export const API_PREFIX = 'api/v1';
export * from './reservations';

export enum OrderType {
  DINE_IN = 'DINE_IN',
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
}
