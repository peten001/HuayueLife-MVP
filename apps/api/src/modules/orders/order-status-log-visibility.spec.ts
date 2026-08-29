import { toCustomerVisibleOrderStatusLogs } from './order-status-log-visibility';

describe('customer order status-log projector', () => {
  it('hides canonical rebalance and empty-release audit events', () => {
    const visible = toCustomerVisibleOrderStatusLogs([
      log(1, 'PENDING_ACCEPTANCE', null),
      log(2, 'ACCEPTED', null),
      log(3, 'ACCEPTED', 'ORDER_ITEM_RETURNED'),
      log(4, 'CANCELLED', 'ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN'),
      log(5, 'CANCELLED', 'DINE_IN_AUTO_RELEASED_EMPTY'),
    ]);

    expect(visible.map(({ id, toStatus }) => ({ id, toStatus }))).toEqual([
      { id: 1, toStatus: 'PENDING_ACCEPTANCE' },
      { id: 2, toStatus: 'ACCEPTED' },
    ]);
  });

  it('collapses consecutive customer-visible statuses and keeps one real cancellation', () => {
    const visible = toCustomerVisibleOrderStatusLogs([
      log(1, 'PENDING_ACCEPTANCE', null),
      log(2, 'ACCEPTED', null),
      log(3, 'ACCEPTED', null),
      log(4, 'CANCELLED', null),
      log(5, 'CANCELLED', null),
    ]);

    expect(visible.map(({ id, toStatus }) => ({ id, toStatus }))).toEqual([
      { id: 1, toStatus: 'PENDING_ACCEPTANCE' },
      { id: 2, toStatus: 'ACCEPTED' },
      { id: 4, toStatus: 'CANCELLED' },
    ]);
  });

  it('honors INTERNAL metadata even for a legacy unknown action', () => {
    const internal = log(1, 'CANCELLED', 'LEGACY_REBALANCE');
    internal.metadata = { visibility: 'INTERNAL' };
    expect(toCustomerVisibleOrderStatusLogs([internal])).toEqual([]);
  });
});

function log(id: number, toStatus: string, action: string | null) {
  return {
    id,
    toStatus,
    action,
    metadata: null as { visibility: string } | null,
    requestKey: null,
    remark: `log-${id}`,
    createdAt: new Date(`2026-08-30T00:00:0${id}.000Z`),
  };
}
