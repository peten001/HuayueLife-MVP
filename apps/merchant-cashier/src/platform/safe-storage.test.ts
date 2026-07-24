import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readCashierStorage,
  removeCashierStorage,
  writeCashierStorage,
} from './safe-storage';

describe('safe cashier storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('degrades safely when a storage property getter is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    });

    expect(readCashierStorage('local', 'token')).toBeNull();
    expect(writeCashierStorage('local', 'token', 'secret')).toBe(false);
    expect(removeCashierStorage('local', 'token')).toBe(false);
  });

  it('degrades safely when storage operations are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Read blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Write blocked', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Remove blocked', 'SecurityError');
    });

    expect(readCashierStorage('session', 'token')).toBeNull();
    expect(writeCashierStorage('session', 'token', 'secret')).toBe(false);
    expect(removeCashierStorage('session', 'token')).toBe(false);
  });
});
