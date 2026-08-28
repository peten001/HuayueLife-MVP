export interface CashierBootstrapOptions {
  loadTables: () => Promise<unknown>;
  loadOrders: () => Promise<unknown>;
  loadPrinting: () => Promise<unknown>;
  markReady: () => void;
  startPolling: () => void;
}

export async function bootstrapCashier(options: CashierBootstrapOptions) {
  const results = await Promise.allSettled([
    options.loadTables(),
    options.loadOrders(),
    options.loadPrinting(),
  ]);
  options.markReady();
  options.startPolling();
  return results;
}
