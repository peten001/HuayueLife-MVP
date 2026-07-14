import { canRunOrderAction } from '@/domain';
import type {
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
  TableSessionDetail,
  TableSessionSummary,
} from '@/types';
import { CashierApiError } from '@/api/error';
import {
  demoMerchantProfile,
  demoStaffSession,
  demoTables,
  initialDemoOrders,
} from './data';

let orders = structuredClone(initialDemoOrders);
let sessionClosed = false;

export function resetDemoRepository() {
  orders = structuredClone(initialDemoOrders);
  sessionClosed = false;
}

export const demoRepository = {
  staff: () => structuredClone(demoStaffSession),
  profile: () => structuredClone(demoMerchantProfile),
  orders: (filters: MerchantOrderFilters = {}) => structuredClone(
    orders.filter((order) =>
      (!filters.status || order.status === filters.status) &&
      (!filters.orderType || order.orderType === filters.orderType),
    ),
  ),
  order: (id: string) => structuredClone(requireOrder(id)),
  runOrderAction(id: string, action: MerchantOrderAction) {
    const order = requireOrder(id);
    if (!canRunOrderAction(order, action)) {
      throw new CashierApiError({ message: '演示订单状态已变化', status: 409, code: 'HTTP_409' });
    }
    order.status = nextStatus(order, action);
    order.updatedAt = new Date().toISOString();
    if (order.status === 'ACCEPTED') order.acceptedAt = order.updatedAt;
    if (order.status === 'READY') order.readyAt = order.updatedAt;
    if (order.status === 'COMPLETED') order.completedAt = order.updatedAt;
    if (order.status === 'CANCELLED') order.cancelledAt = order.updatedAt;
    return structuredClone(order);
  },
  tables: () => structuredClone(demoTables),
  openSessions: () => sessionClosed ? [] : [buildSessionSummary()],
  currentSession: (tableId: string) =>
    tableId === 'demo-table-1' && !sessionClosed ? buildSessionSummary() : null,
  session: (id: string) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    return buildSessionDetail();
  },
  closeSession: (id: string) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    const detail = buildSessionDetail();
    if (detail.unfinishedOrderCount > 0) {
      throw new CashierApiError({ message: '仍有未完成演示订单', status: 409, code: 'TABLE_SESSION_HAS_UNFINISHED_ORDERS' });
    }
    sessionClosed = true;
    return buildSessionDetail();
  },
};

function requireOrder(id: string) {
  const order = orders.find((item) => item.id === id);
  if (!order) throw notFound('Demo order not found');
  return order;
}

function nextStatus(order: MerchantOrder, action: MerchantOrderAction): MerchantOrder['status'] {
  if (action === 'accept') return 'ACCEPTED';
  if (action === 'reject') return 'CANCELLED';
  if (action === 'start-preparing') return 'PREPARING';
  if (action === 'ready') return 'READY';
  if (action === 'start-delivery') return 'DELIVERING';
  return 'COMPLETED';
}

function tableOrders() {
  return orders.filter((order) => order.tableSessionId === 'demo-session-1');
}

function buildSessionSummary(): TableSessionSummary {
  const related = tableOrders();
  const billable = related.filter((order) => order.status !== 'CANCELLED');
  const unfinished = related.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status));
  return {
    id: 'demo-session-1', sessionNo: 'DEMO-SESSION-1', merchantId: 'demo-merchant', tableId: 'demo-table-1', tableNo: 'A01', tableName: '演示桌 A01', status: sessionClosed ? 'CLOSED' : 'OPEN', openedAt: related.at(-1)?.createdAt ?? new Date().toISOString(), closedAt: sessionClosed ? new Date().toISOString() : null,
    orderCount: billable.length, itemCount: billable.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0), totalAmountVnd: String(billable.reduce((sum, order) => sum + Number(order.totalAmountVnd), 0)), latestOrderAt: related[0]?.createdAt ?? null, pendingOrderCount: related.filter((order) => order.status === 'PENDING_ACCEPTANCE').length, unfinishedOrderCount: unfinished.length,
  };
}

function buildSessionDetail(): TableSessionDetail {
  return {
    ...buildSessionSummary(),
    orders: tableOrders().map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status, createdAt: order.createdAt, itemAmountVnd: order.itemAmountVnd, deliveryFeeVnd: order.deliveryFeeVnd, totalAmountVnd: order.totalAmountVnd, tableNoSnapshot: order.tableNoSnapshot, items: order.items.map((item) => ({ id: item.id, productNameZhSnapshot: item.productNameZhSnapshot, quantity: item.quantity, unitPriceVnd: item.unitPriceVnd ?? '0', subtotalVnd: item.subtotalVnd })) })),
  };
}

function notFound(message: string) {
  return new CashierApiError({ message, status: 404, code: 'HTTP_404' });
}
