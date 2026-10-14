import type { KdsOrder, KdsTask } from './kds-types';

export function pendingQuantity(task: KdsTask) { return Math.max(0, task.quantity - task.madeQuantity); }
export function servingQuantity(task: KdsTask) { return Math.max(0, task.madeQuantity - task.servedQuantity); }
export function canMakeKitchenTask(task: KdsTask) {
  return pendingQuantity(task) > 0 && task.order.status !== 'CANCELLED' &&
    (task.order.orderType === 'DINE_IN' || !['READY', 'DELIVERING', 'COMPLETED'].includes(task.order.status));
}
export interface KitchenOrderGroup {
  key: string; order: KdsOrder; orders: KdsOrder[]; tasks: KdsTask[]; visibleTasks: KdsTask[];
  pendingTasks: KdsTask[]; quantity: number; allMade: boolean;
}
export function kitchenOrderKey(task: KdsTask) {
  // A table number can be reused; only the same dining session may share a card.
  return task.order.orderType === 'DINE_IN' && task.order.tableSessionId
    ? `session:${task.order.tableSessionId}` : `order:${task.orderId}`;
}
export function groupKitchenOrders(allTasks: KdsTask[], scopeTasks: KdsTask[]): KitchenOrderGroup[] {
  const groups = new Map<string, KitchenOrderGroup>();
  for (const task of scopeTasks) {
    if (task.quantity <= 0 || task.order.status === 'CANCELLED') continue;
    const key = kitchenOrderKey(task);
    const group = groups.get(key) ?? { key, order: task.order, orders: [], tasks: [], visibleTasks: [],
      pendingTasks: [], quantity: 0, allMade: false };
    group.visibleTasks.push(task);
    if (canMakeKitchenTask(task)) { group.pendingTasks.push(task); group.quantity += pendingQuantity(task); }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.tasks = allTasks.filter(task => kitchenOrderKey(task) === group.key && task.order.status !== 'CANCELLED');
    group.orders = [...new Map(group.tasks.filter(task => task.quantity > 0).map(task => [task.orderId, task.order])).values()];
    group.allMade = group.orders.every(order => orderKitchenProgress(group.tasks.filter(task => task.orderId === order.id)).allMade);
  }
  return [...groups.values()].sort((a, b) => Number(b.pendingTasks.some(task => task.urgentAt)) - Number(a.pendingTasks.some(task => task.urgentAt)) ||
    Date.parse(a.visibleTasks[0]!.createdAt) - Date.parse(b.visibleTasks[0]!.createdAt));
}
export function dishGroupKey(task: KdsTask) {
  return JSON.stringify([task.station, task.productId, task.dishName, task.unit, task.remark?.trim() ?? '', task.order.customerRemark?.trim() ?? '']);
}
export function groupKitchenTasks(tasks: KdsTask[]) {
  const groups = new Map<string, { key: string; name: string; unit: string; remark: string; station: string; tasks: KdsTask[]; quantity: number }>();
  for (const task of tasks) {
    if (!canMakeKitchenTask(task)) continue;
    const key = dishGroupKey(task);
    const group = groups.get(key) ?? { key, name: task.dishName, unit: task.unit,
      remark: [task.remark, task.order.customerRemark].filter(Boolean).join(' · '), station: task.station, tasks: [], quantity: 0 };
    group.tasks.push(task);
    group.quantity += pendingQuantity(task);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.tasks.some(task => task.urgentAt)) - Number(a.tasks.some(task => task.urgentAt)) ||
    Date.parse(a.tasks[0]!.createdAt) - Date.parse(b.tasks[0]!.createdAt));
}
export function orderKitchenProgress(orderTasks: KdsTask[]) {
  const order = orderTasks[0]?.order;
  const missing = order?.items.filter(item => {
    const task = orderTasks.find(row => row.orderItemId === item.id);
    return !task || task.quantity !== item.quantity || task.madeQuantity < item.quantity;
  }) ?? [];
  return { missing, allMade: Boolean(order?.items.length && !missing.length) };
}
