export type CashierStorageArea = 'local' | 'session';

function resolveStorage(area: CashierStorageArea): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCashierStorage(area: CashierStorageArea, key: string): string | null {
  const storage = resolveStorage(area);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeCashierStorage(
  area: CashierStorageArea,
  key: string,
  value: string,
): boolean {
  const storage = resolveStorage(area);
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeCashierStorage(area: CashierStorageArea, key: string): boolean {
  const storage = resolveStorage(area);
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
