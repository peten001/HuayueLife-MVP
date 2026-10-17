// Isolated fixture used only by the cashier's explicitly enabled demo session.
import type { KdsAction, KdsBoard, KdsLine, KdsOrder, KdsSettings, KdsTask } from './kds-types';
import { orderKitchenProgress, pendingQuantity, servingQuantity } from './kds-domain';
import { kdsRequestKey } from './kds-text';

let state: KdsBoard | null = null;
const replay = new Map<string, string>();
const history = new Map<string, KdsTask[]>();
function initial(): KdsBoard {
  const tasks: KdsTask[] = [];
  const definitions: [string, KdsOrder['orderType'], number, string][] = [
    ['1', 'DINE_IN', 3, '01'], ['2', 'DINE_IN', 2, '02'], ['3', 'PICKUP', 1, '1038'], ['4', 'DELIVERY', 2, '2026'],
  ];
  const add = (dishName: string, quantity: number, order: KdsOrder, productId: string, remark: string | null = null) => {
    const id = String(tasks.length + 1);
    order.items.push({ id, quantity, productNameZhSnapshot: dishName });
    tasks.push({ id, orderId: order.id, orderItemId: id, productId, dishName, unit: '份', remark, station: '烧烤档', quantity,
      madeQuantity: 0, servedQuantity: 0, cancelledQuantity: 0, version: 1, startedAt: null, urgentAt: null,
      createdAt: order.createdAt, order });
  };
  const orders = definitions.map(([id, orderType, quantity, label], index) => {
    const order: KdsOrder = { id, orderNo: `DEMO-${label}`, orderType, status: 'PREPARING',
      tableNo: orderType === 'DINE_IN' ? label : null, customerRemark: null,
      tableSessionId: orderType === 'DINE_IN' ? `demo-session-${id}` : null,
      createdAt: new Date(Date.now() - (8 - index * 2) * 60000).toISOString(), kdsPackedAt: null,
      pickupCode: orderType === 'PICKUP' ? label : null, items: [] };
    add('烤羊肉串', quantity, order, '1', '少辣');
    return order;
  });
  const rest: [string, number, number][] = [['烤牛肉串', 2, 0], ['烤韭菜', 2, 1], ['烤韭菜', 1, 2], ['烤鸡翅', 2, 3],
    ['烤茄子', 2, 1], ['烤玉米', 1, 2], ['烤五花肉', 1, 3], ['烤金针菇', 2, 0], ['铁板土豆片', 1, 2], ['铁板土豆片', 2, 3]];
  rest.forEach(([name, quantity, index]) => add(name, quantity, orders[index]!, name));
  return { settings: { enabled: true, servingEnabled: true, timeoutMinutes: 7, stations: ['热厨', '烧烤档', '粉面档', '吧台'], categoryRoutes: [] },
    tasks, operations: [], categories: [], serverTime: new Date().toISOString() };
}
function board() { state ??= initial(); return JSON.parse(JSON.stringify(state)) as KdsBoard; }
function finishOrders() {
  for (const orderId of new Set(state!.tasks.map(task => task.orderId))) {
    const tasks = state!.tasks.filter(task => task.orderId === orderId);
    if (tasks[0]!.order.orderType !== 'DINE_IN' && orderKitchenProgress(tasks).allMade && tasks.every(task => task.servedQuantity === task.quantity)) {
      tasks.forEach(task => { task.order.status = 'READY'; task.order.kdsPackedAt ??= new Date().toISOString(); });
    }
  }
}
function record(kind: string, lines: KdsLine[], key: string) {
  const id = kdsRequestKey();
  replay.set(key, id);
  state!.operations.unshift({ id, kind, staffId: 'demo', reversedAt: null, createdAt: new Date().toISOString(),
    lines: lines.map(line => { const task = state!.tasks.find(row => row.id === line.taskId)!; return { ...line, orderId: task.orderId, dishName: task.dishName, station: task.station, orderNo: task.order.orderNo, orderType: task.order.orderType, tableNo: task.order.tableNo }; }) });
  return { operationId: id, replay: false };
}
export const demoKds = {
  board,
  settings(settings: KdsSettings) {
    board(); state!.settings = { ...settings, servingEnabled: settings.servingEnabled ?? state!.settings.servingEnabled ?? false };
    if (state!.settings.servingEnabled === false) {
      state!.tasks.filter(task => task.madeQuantity > task.servedQuantity).forEach(task => { task.servedQuantity = task.madeQuantity; task.version++; });
      finishOrders();
    }
    return state!.settings;
  },
  action(action: KdsAction, lines: KdsLine[], key: string) {
    board(); if (replay.has(key)) return { operationId: replay.get(key)!, replay: true };
    if (action === 'SERVE' && state!.settings.servingEnabled === false) throw new Error('当前门店未开启传菜');
    const before = board().tasks;
    const selected = lines.map(line => {
      const task = state!.tasks.find(row => row.id === line.taskId);
      if (!task || task.version !== line.version || line.quantity <= 0 ||
        (action === 'MAKE' && line.quantity > pendingQuantity(task)) ||
        (action === 'SERVE' && line.quantity > servingQuantity(task))) throw new Error('演示菜品数量已变化');
      return { task, line };
    });
    selected.forEach(({ task, line }) => {
      if (action === 'MAKE') task.madeQuantity += line.quantity;
      if (action === 'MAKE' && state!.settings.servingEnabled === false) task.servedQuantity = task.madeQuantity;
      if (action === 'SERVE') task.servedQuantity += line.quantity;
      if (action === 'URGE') task.urgentAt = new Date().toISOString();
      if (action === 'START' || action === 'MAKE') task.startedAt ??= new Date().toISOString(); task.version++;
    });
    if (action === 'SERVE' || (action === 'MAKE' && state!.settings.servingEnabled === false)) finishOrders();
    const result = record(action, lines, key); history.set(result.operationId, before); return result;
  },
  pack(orderId: string, key: string) {
    board(); if (replay.has(key)) return { operationId: replay.get(key)!, replay: true };
    const tasks = state!.tasks.filter(task => task.orderId === orderId);
    if (!orderKitchenProgress(tasks).allMade) throw new Error('菜品尚未齐全');
    const lines = tasks.map(task => ({ taskId: task.id, version: task.version, quantity: servingQuantity(task) }));
    tasks.forEach(task => { task.servedQuantity = task.madeQuantity; task.version++; task.order.status = 'READY'; task.order.kdsPackedAt = new Date().toISOString(); });
    return record('PACK', lines, key);
  },
  undo(id: string, key: string) {
    board(); if (replay.has(key)) return { operationId: replay.get(key)!, replay: true };
    const operation = state!.operations.find(op => op.id === id);
    const before = history.get(id);
    if (!operation || operation.reversedAt || !before) throw new Error('该操作不能撤销');
    for (const line of operation.lines) {
      const old = before.find(task => task.id === line.taskId)!;
      const current = state!.tasks.find(task => task.id === line.taskId)!;
      if (current.version !== old.version + 1) throw new Error('菜品已有后续操作');
    }
    for (const line of operation.lines) {
      const old = before.find(task => task.id === line.taskId)!;
      const current = state!.tasks.find(task => task.id === line.taskId)!;
      current.madeQuantity = old.madeQuantity; current.servedQuantity = old.servedQuantity; current.version++;
    }
    operation.reversedAt = new Date().toISOString();
    return record('UNDO', operation.lines.map(line => ({ taskId: line.taskId, version: 1, quantity: line.quantity })), key);
  },
};
