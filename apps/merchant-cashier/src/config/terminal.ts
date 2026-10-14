export const isKdsTerminal = import.meta.env.VITE_TERMINAL_MODE === 'kds';

export const kdsEntryUrl = import.meta.env.PROD
  ? import.meta.env.VITE_KDS_URL?.trim() || 'https://kds.huayueyouxuan.com/'
  : '/kds';

export const cashierEntryUrl = (
  import.meta.env.VITE_CASHIER_URL?.trim() || 'https://cashier.huayueyouxuan.com'
).replace(/\/+$/, '');

export function loginDestination(requested: unknown) {
  if (isKdsTerminal) return '/';
  return typeof requested === 'string' ? requested : '/tables';
}
