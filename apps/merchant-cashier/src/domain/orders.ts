import type {
  MerchantOrder,
  MerchantOrderAction,
  OrderStatus,
  OrderType,
} from '@/types';

export const PENDING_ORDER_STATUS: OrderStatus = 'PENDING_ACCEPTANCE';
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERING',
];
export const HISTORY_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export interface OrderActionRule {
  action: MerchantOrderAction;
  from: OrderStatus;
  to: OrderStatus;
  orderTypes?: readonly OrderType[];
}

const BASE_ACTION_RULES: readonly OrderActionRule[] = [
  { action: 'accept', from: 'PENDING_ACCEPTANCE', to: 'ACCEPTED' },
  { action: 'reject', from: 'PENDING_ACCEPTANCE', to: 'CANCELLED' },
  { action: 'reject', from: 'ACCEPTED', to: 'CANCELLED' },
  { action: 'start-preparing', from: 'ACCEPTED', to: 'PREPARING' },
  { action: 'ready', from: 'PREPARING', to: 'READY' },
  {
    action: 'start-delivery',
    from: 'READY',
    to: 'DELIVERING',
    orderTypes: ['DELIVERY'],
  },
  {
    action: 'complete',
    from: 'READY',
    to: 'COMPLETED',
    orderTypes: ['DINE_IN', 'PICKUP'],
  },
  {
    action: 'complete',
    from: 'DELIVERING',
    to: 'COMPLETED',
    orderTypes: ['DELIVERY'],
  },
];

export function availableOrderActions(order: Pick<MerchantOrder, 'status' | 'orderType'>) {
  return BASE_ACTION_RULES.filter(
    (rule) =>
      rule.from === order.status &&
      (!rule.orderTypes || rule.orderTypes.includes(order.orderType)),
  ).map((rule) => rule.action);
}

export function canRunOrderAction(
  order: Pick<MerchantOrder, 'status' | 'orderType'>,
  action: MerchantOrderAction,
) {
  return availableOrderActions(order).includes(action);
}

export function mergeOrders(...collections: readonly MerchantOrder[][]) {
  const byId = new Map<string, MerchantOrder>();
  collections.flat().forEach((order) => byId.set(order.id, order));
  return [...byId.values()].sort(compareOrdersNewestFirst);
}

export function replaceOrder(collection: readonly MerchantOrder[], nextOrder: MerchantOrder) {
  return collection
    .map((order) => (order.id === nextOrder.id ? nextOrder : order))
    .sort(compareOrdersNewestFirst);
}

export function searchOrders(collection: readonly MerchantOrder[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [...collection];
  return collection.filter((order) =>
    [
      order.orderNo,
      order.tableNoSnapshot,
      order.table?.tableNo,
      order.table?.tableName,
      order.contactName,
      order.contactPhone,
      order.deliveryAddress,
      ...order.items.map((item) => item.productNameZhSnapshot),
    ].some((value) => value?.toLocaleLowerCase().includes(query)),
  );
}

export function compareOrdersNewestFirst(left: MerchantOrder, right: MerchantOrder) {
  const timeDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  return timeDelta || right.id.localeCompare(left.id, undefined, { numeric: true });
}
