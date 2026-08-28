import { describe, expect, it, vi } from 'vitest';
import { bootstrapCashier } from './cashier-bootstrap';

describe('cashier bootstrap owner', () => {
  it('starts one polling coordinator only after all first-load requests settle', async () => {
    const tables = deferred<void>();
    const orders = deferred<void>();
    const printing = deferred<void>();
    const events: string[] = [];

    const request = bootstrapCashier({
      loadTables: vi.fn(() => tables.promise),
      loadOrders: vi.fn(() => orders.promise),
      loadPrinting: vi.fn(() => printing.promise),
      markReady: () => events.push('ready'),
      startPolling: () => events.push('polling'),
    });

    tables.resolve();
    orders.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);
    printing.resolve();
    await request;

    expect(events).toEqual(['ready', 'polling']);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
