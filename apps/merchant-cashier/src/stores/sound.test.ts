import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cashierStorageKeys } from '@/config';

describe('cashier sound preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('uses the existing default when there is no stored preference', async () => {
    const { useSoundStore } = await import('./sound');
    expect(useSoundStore().enabled).toBe(false);
  });

  it('restores enabled and disabled values from the terminal-local preference', async () => {
    localStorage.setItem(cashierStorageKeys.soundEnabled, '1');
    let { useSoundStore } = await import('./sound');
    expect(useSoundStore().enabled).toBe(true);

    vi.resetModules();
    setActivePinia(createPinia());
    localStorage.setItem(cashierStorageKeys.soundEnabled, '0');
    ({ useSoundStore } = await import('./sound'));
    expect(useSoundStore().enabled).toBe(false);
  });
});
