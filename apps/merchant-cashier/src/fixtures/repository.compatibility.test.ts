import { afterEach, describe, expect, it, vi } from 'vitest';

describe('fixture repository WebView compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('imports and clones fixture data when structuredClone is unavailable', async () => {
    vi.stubGlobal('structuredClone', undefined);
    vi.resetModules();

    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    const firstRead = demoRepository.orders();
    const originalOrderNo = firstRead[0]?.orderNo;
    if (firstRead[0]) firstRead[0].orderNo = 'MUTATED-OUTSIDE-REPOSITORY';

    expect(demoRepository.orders()[0]?.orderNo).toBe(originalOrderNo);
    expect(demoRepository.openSessions()[0]?.openedAt).toBeTruthy();
  });

  it('keeps demo checkout isolated when new dine-in orders are already accepted', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    demoRepository.setSessionRounding('demo-session-1', true);
    expect(demoRepository.session('demo-session-1')).toEqual(expect.objectContaining({
      originalAmountVnd: '513000',
      roundingAmountVnd: '3000',
      payableAmountVnd: '510000',
    }));
    const result = demoRepository.checkoutSession('demo-session-1');

    expect(result.session.status).toBe('CLOSED');
    expect(result.session).toEqual(expect.objectContaining({
      originalAmountVnd: '513000',
      roundingAmountVnd: '3000',
      payableAmountVnd: '510000',
    }));
    expect(result.orders.filter((order) => order.status !== 'CANCELLED').every((order) => order.status === 'COMPLETED')).toBe(true);
    expect(result.orders.filter((order) => order.status !== 'CANCELLED').every((order) => order.totalAmountVnd === '171000')).toBe(true);
    const checkedOrders = result.orders.filter((order) => order.statusLogs?.some((log) => log.action === 'TABLE_SESSION_CHECKOUT'));
    expect(checkedOrders).toHaveLength(3);
    expect(checkedOrders.every((order) =>
      order.statusLogs?.some((log) => log.action === 'TABLE_SESSION_CHECKOUT' && log.metadata?.originalAmountVnd === '513000' && log.metadata.roundingAmountVnd === '3000' && log.metadata.payableAmountVnd === '510000'),
    )).toBe(true);
    expect(result.orders.every((order) => order.settlementStatus === 'UNSETTLED')).toBe(true);
    expect(demoRepository.openSessions()).toEqual([]);
  });
});
