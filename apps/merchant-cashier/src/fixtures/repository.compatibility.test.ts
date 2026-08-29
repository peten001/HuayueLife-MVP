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

  it('opens one empty demo table session and persists direct product additions into it', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    expect(demoRepository.currentSession('demo-table-10')).toBeNull();
    const opened = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'add-open-b04',
      items: [],
    });
    const replay = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'add-open-b04',
      items: [],
    });
    const added = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'add-product-b04',
      items: [{ productId: demoRepository.products()[0]!.id, quantity: 1 }],
    });

    expect(opened).toEqual(replay);
    expect(opened.order).toBeNull();
    expect(opened.session).toEqual(expect.objectContaining({ tableId: 'demo-table-10', tableNo: 'B04', status: 'OPEN' }));
    expect(added.order).toEqual(expect.objectContaining({ tableId: 'demo-table-10', tableSessionId: opened.session.id }));
    expect(added.session.itemCount).toBe(1);
    expect(demoRepository.openSessions().filter((session) => session.tableId === 'demo-table-10')).toHaveLength(1);
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

  it('closes and releases a dynamically opened demo table after its final item is returned', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    const opened = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'fixture-open-dynamic-table',
      items: [],
    });
    const added = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'fixture-add-dynamic-table-item',
      items: [{ productId: demoRepository.products()[0]!.id, quantity: 1 }],
    });
    const item = added.order!.items[0]!;
    const returned = demoRepository.returnOrderItem(added.order!.id, item.id, {
      requestKey: 'fixture-return-dynamic-table-final-item',
      expectedQuantity: 1,
      returnQuantity: 1,
    });

    expect(returned.order).toEqual(expect.objectContaining({
      status: 'CANCELLED',
      settlementStatus: 'UNSETTLED',
      items: [],
    }));
    expect(returned.session).toEqual(expect.objectContaining({
      id: opened.session.id,
      tableId: 'demo-table-10',
      status: 'CLOSED',
      itemCount: 0,
      totalAmountVnd: '0',
    }));
    expect(demoRepository.currentSession('demo-table-10')).toBeNull();
    expect(demoRepository.openSessions().some((session) => session.id === opened.session.id)).toBe(false);
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

  it('auto-closes an empty canonical session without an explicit release', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();
    const opened = demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'canonical-open-b04',
      items: [],
    });
    demoRepository.createTableOrder('demo-table-10', {
      idempotencyKey: 'canonical-add-b04',
      items: [{ productId: demoRepository.products()[0]!.id, quantity: 1 }],
    });
    const before = demoRepository.canonicalState(opened.session.id);
    const empty = demoRepository.reconcileCanonicalState(opened.session.id, {
      requestKey: 'canonical-empty-b04',
      baseRevision: before.revision,
      desiredItems: before.items.map((line) => ({ lineKey: line.lineKey, desiredQuantity: 0 })),
    });

    expect(empty.items).toEqual([]);
    expect(empty.sessionStatus).toBe('CLOSED');
    expect(empty.releasedBecause).toBe('EMPTY_AFTER_RECONCILE');
    expect(demoRepository.currentSession('demo-table-10')).toBeNull();
  });

  it('replays an exact canonical desired-state request without a second write', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();
    const before = demoRepository.canonicalState('demo-session-1');
    const input = {
      requestKey: 'canonical-replay-a01',
      baseRevision: before.revision,
      desiredItems: before.items.map((line, index) => ({
        lineKey: line.lineKey,
        desiredQuantity: line.quantity + (index === 0 ? 1 : 0),
      })),
    };
    const first = demoRepository.reconcileCanonicalState('demo-session-1', input);
    const replay = demoRepository.reconcileCanonicalState('demo-session-1', input);
    expect(replay.revision).toBe(first.revision);
    expect(replay.idempotentReplay).toBe(true);
  });

  it('exposes completed history as settlement records with search and pagination', async () => {
    vi.resetModules();
    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    const page = demoRepository.settlements({ status: 'COMPLETED', pageSize: 2 });

    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((item) => item.kind === 'ORDER')).toBe(true);
    expect(page.items.every((item) => item.finalReceivableVnd)).toBeTruthy();

    const searched = demoRepository.settlements({
      search: 'demo-order-0995',
    });
    expect(searched.total).toBe(1);
    expect(searched.items[0]!.settlementId).toBe('order:demo-order-0995');

    const detail = demoRepository.settlement('order:demo-order-0997');
    expect(detail.orderType).toBe('DELIVERY');
    expect(detail.sourceOrders).toHaveLength(1);
  });
});
