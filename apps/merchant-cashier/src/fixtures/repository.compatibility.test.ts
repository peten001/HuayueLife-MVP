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

  it('cancels an order returned to empty while other table orders remain effective', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();
    const order = demoRepository.order('demo-order-1001');
    const item = order.items[0]!;

    const result = demoRepository.returnOrderItem(order.id, item.id, {
      requestKey: 'fixture-return-one-order',
      expectedQuantity: item.quantity,
      returnQuantity: item.quantity,
    });

    expect(result.order).toEqual(expect.objectContaining({
      status: 'CANCELLED',
      itemAmountVnd: '0',
      totalAmountVnd: '0',
      items: [],
    }));
    expect(result.session).toEqual(expect.objectContaining({
      status: 'OPEN',
      itemCount: 4,
      orderCount: 2,
    }));
    expect(demoRepository.openSessions()).toHaveLength(1);
  });

  it('returns the final table item, closes the session, and replays the same key idempotently', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    for (const orderId of ['demo-order-1001', 'demo-order-1006']) {
      const order = demoRepository.order(orderId);
      const item = order.items[0]!;
      demoRepository.returnOrderItem(order.id, item.id, {
        requestKey: `fixture-empty-${order.id}`,
        expectedQuantity: item.quantity,
        returnQuantity: item.quantity,
      });
    }

    const lastOrder = demoRepository.order('demo-order-0999');
    const lastItem = lastOrder.items[0]!;
    const input = {
      requestKey: 'fixture-return-final-table-item',
      expectedQuantity: lastItem.quantity,
      returnQuantity: lastItem.quantity,
    };
    const first = demoRepository.returnOrderItem(lastOrder.id, lastItem.id, input);
    const replay = demoRepository.returnOrderItem(lastOrder.id, lastItem.id, input);

    expect(first).toEqual(replay);
    expect(first.order).toEqual(expect.objectContaining({
      status: 'CANCELLED',
      settlementStatus: 'UNSETTLED',
      items: [],
    }));
    expect(first.session).toEqual(expect.objectContaining({
      status: 'CLOSED',
      itemCount: 0,
      totalAmountVnd: '0',
    }));
    expect(demoRepository.openSessions()).toEqual([]);
    expect(() => demoRepository.returnOrderItem(lastOrder.id, lastItem.id, {
      ...input,
      requestKey: 'fixture-return-after-close',
    })).toThrowError(expect.objectContaining({ code: 'TABLE_SESSION_CLOSED' }));
  });

  it('keeps the order and table open after a partial return', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();
    const order = demoRepository.order('demo-order-1001');
    const item = order.items[0]!;

    const result = demoRepository.returnOrderItem(order.id, item.id, {
      requestKey: 'fixture-partial-return',
      expectedQuantity: item.quantity,
      returnQuantity: 1,
    });

    expect(result.order).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
    expect(result.order?.items[0]?.quantity).toBe(item.quantity - 1);
    expect(result.session.status).toBe('OPEN');
    expect(result.session.itemCount).toBe(6);
  });
});
