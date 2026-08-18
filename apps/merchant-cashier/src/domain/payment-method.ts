import type { PaymentMethod } from '@/types';

export type PaymentMethodDisplayKey =
  | 'payment.cash'
  | 'payment.bankTransfer'
  | 'summary.unrecorded';

/**
 * Single resolver for order-history payment display. Unknown future enum
 * values must never be mistaken for cash; they fall back to the recorded
 * "unrecorded" copy like null/missing values.
 */
export function paymentMethodDisplayKey(
  method: PaymentMethod | string | null | undefined,
): PaymentMethodDisplayKey {
  if (method === 'CASH') return 'payment.cash';
  if (method === 'BANK_TRANSFER') return 'payment.bankTransfer';
  return 'summary.unrecorded';
}
