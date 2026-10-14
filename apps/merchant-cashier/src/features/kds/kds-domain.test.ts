import { describe, expect, it } from 'vitest';
import { demoKds } from './kds-demo';
import { canMakeKitchenTask, groupKitchenOrders, groupKitchenTasks, orderKitchenProgress, pendingQuantity, servingQuantity } from './kds-domain';
describe('KDS order ownership and aggregate grouping', () => {
  it('aggregates the same dish across two tables, pickup and delivery while retaining each original item', () => {
    const board = demoKds.board();
    const group = groupKitchenTasks(board.tasks)[0]!;
    expect(group.quantity).toBe(8);
    expect(group.tasks.map(task => [task.order.orderType, task.quantity])).toEqual([['DINE_IN', 3], ['DINE_IN', 2], ['PICKUP', 1], ['DELIVERY', 2]]);
    expect(board.tasks.reduce((sum, task) => sum + pendingQuantity(task), 0)).toBe(24);
  });
  it('keeps station, dish variants and order-level preparation notes separate', () => {
    const task = demoKds.board().tasks[0]!;
    const modified = [task, { ...task, id: 'other-station', station: '热厨' }, { ...task, id: 'other-remark', remark: '免辣' },
      { ...task, id: 'order-remark', order: { ...task.order, customerRemark: '过敏：花生' } }];
    expect(groupKitchenTasks(modified)).toHaveLength(4);
  });
  it('requires every ordered item, including items on another station, before packing', () => {
    const task = demoKds.board().tasks.find(task => task.order.orderType === 'PICKUP')!;
    const complete = { ...task, madeQuantity: task.quantity };
    expect(orderKitchenProgress([complete]).allMade).toBe(false);
    const all = demoKds.board().tasks.filter(row => row.orderId === task.orderId).map(row => ({ ...row, madeQuantity: row.quantity }));
    expect(orderKitchenProgress(all).allMade).toBe(true);
  });
  it('merges only the same dining session and preserves the original order identities', () => {
    const first = demoKds.board().tasks[0]!;
    const addition = { ...first, id: 'add', orderId: 'add-order', order: { ...first.order, id: 'add-order' } };
    const nextVisit = { ...first, id: 'next', orderId: 'next-order', order: { ...first.order, id: 'next-order', tableSessionId: 'next-visit' } };
    const groups = groupKitchenOrders([first, addition, nextVisit], [first, addition, nextVisit]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.orders.map(order => order.id)).toEqual([first.orderId, 'add-order']);
    expect(groups[0]!.pendingTasks.map(task => task.id)).toEqual([first.id, 'add']);
    expect(groups[1]!.orders[0]!.id).toBe('next-order');
  });
  it('does not guess table grouping when the server has no session identity', () => {
    const first = demoKds.board().tasks[0]!;
    const old = { ...first, order: { ...first.order, tableSessionId: null } };
    const other = { ...old, id: 'other', orderId: 'other-order', order: { ...old.order, id: 'other-order' } };
    expect(groupKitchenOrders([old, other], [old, other])).toHaveLength(2);
  });
  it('keeps station scope separate from overall order readiness', () => {
    const task = demoKds.board().tasks[0]!;
    const complete = { ...task, madeQuantity: task.quantity };
    const other = { ...task, id: 'bar', orderItemId: 'bar-item', station: '吧台', quantity: 1 };
    const order = { ...task.order, items: [task.order.items[0]!, { id: 'bar-item', quantity: 1, productNameZhSnapshot: '茶饮' }] };
    complete.order = order; other.order = order;
    const group = groupKitchenOrders([complete, other], [complete])[0]!;
    expect(group.quantity).toBe(0);
    expect(group.visibleTasks).toHaveLength(1);
    expect(group.allMade).toBe(false);
  });
  it('retains financially completed dine-in work but excludes cancelled and handed-off orders', () => {
    const task = demoKds.board().tasks[0]!;
    expect(canMakeKitchenTask({ ...task, order: { ...task.order, status: 'COMPLETED' } })).toBe(true);
    expect(canMakeKitchenTask({ ...task, order: { ...task.order, status: 'CANCELLED' } })).toBe(false);
    for (const status of ['READY', 'DELIVERING', 'COMPLETED']) {
      expect(canMakeKitchenTask({ ...task, order: { ...task.order, orderType: 'DELIVERY', status } })).toBe(false);
    }
  });
  it('does not let an empty retired order block readiness for the same dining session', () => {
    const task = demoKds.board().tasks[0]!;
    const complete = { ...task, madeQuantity: task.quantity, order: { ...task.order, items: [task.order.items[0]!] } };
    const retired = { ...task, id: 'retired', orderId: 'retired-order', quantity: 0,
      order: { ...task.order, id: 'retired-order', status: 'COMPLETED', items: [] } };
    const group = groupKitchenOrders([complete, retired], [complete, retired])[0]!;
    expect(group.orders).toHaveLength(1);
    expect(group.allMade).toBe(true);
  });
  it('completes only table 01 and replays one request without making two more', () => {
    const board = demoKds.board();
    const first = board.tasks[0]!;
    const key = 'kds-test-partial-01';
    const lines = [{ taskId: first.id, version: first.version, quantity: 2 }];
    demoKds.action('MAKE', lines, key);
    demoKds.action('MAKE', lines, key);
    const after = demoKds.board();
    expect(pendingQuantity(after.tasks[0]!)).toBe(1);
    expect(servingQuantity(after.tasks[0]!)).toBe(2);
    expect(after.tasks[1]!.madeQuantity).toBe(0);
    expect(after.tasks.reduce((sum, task) => sum + pendingQuantity(task), 0)).toBe(22);
  });
});
