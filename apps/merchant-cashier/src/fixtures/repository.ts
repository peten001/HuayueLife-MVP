import { canRunOrderAction } from '@/domain';
import type {
  CreateMerchantTableOrderInput,
  DecreaseMerchantOrderItemInput,
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
  MerchantOrderMutationResult,
  ReturnMerchantOrderItemInput,
  TableSessionDetail,
  TableSessionSummary,
} from '@/types';
import { CashierApiError } from '@/api/error';
import {
  demoMerchantProfile,
  demoMenuCategories,
  demoMenuProducts,
  demoStaffSession,
  demoTables,
  initialDemoOrders,
} from './data';

let orders = structuredClone(initialDemoOrders);
let sessionClosed = false;
let nextAddedOrder = 1;
let adjustmentResults = new Map<string, MerchantOrderMutationResult>();

export function resetDemoRepository() {
  orders = structuredClone(initialDemoOrders);
  sessionClosed = false;
  nextAddedOrder = 1;
  adjustmentResults = new Map();
}

export const demoRepository = {
  staff: () => structuredClone(demoStaffSession),
  profile: () => structuredClone(demoMerchantProfile),
  categories: () => structuredClone(demoMenuCategories),
  products: () => structuredClone(demoMenuProducts),
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
  createTableOrder(
    tableId: string,
    input: CreateMerchantTableOrderInput,
  ): MerchantOrderMutationResult {
    requireOpenDemoTable(tableId);
    const existing = orders.find((order) =>
      order.createdByStaffId === demoStaffSession.id
      && order.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return mutationResult(existing);

    if (!input.items.length) {
      return { order: null, session: buildSessionDetail() };
    }

    const selected = input.items
      .filter((item) => item.quantity > 0)
      .map((item, index) => {
        const product = demoMenuProducts.find((candidate) => candidate.id === item.productId);
        if (!product || product.status !== 'ON_SALE') {
          throw conflict('PRODUCT_NOT_AVAILABLE', 'Demo product is unavailable');
        }
        const subtotal = BigInt(product.priceVnd) * BigInt(item.quantity);
        return {
          id: `demo-added-item-${nextAddedOrder}-${index + 1}`,
          productId: product.id,
          productNameZhSnapshot: product.nameZh,
          productNameViSnapshot: product.nameVi,
          imageUrlSnapshot: product.imageUrl,
          unitPriceVnd: product.priceVnd,
          quantity: item.quantity,
          subtotalVnd: subtotal.toString(),
          remark: item.remark?.trim() || null,
        };
      });
    const total = selected.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n).toString();
    const now = new Date().toISOString();
    const sequence = nextAddedOrder++;
    const order: MerchantOrder = {
      id: `demo-added-order-${sequence}`,
      orderNo: `DEMO-ADD-${String(sequence).padStart(3, '0')}`,
      idempotencyKey: input.idempotencyKey,
      userId: null,
      createdByStaffId: demoStaffSession.id,
      merchantId: demoStaffSession.merchant.id,
      tableId,
      tableSessionId: 'demo-session-1',
      tableNoSnapshot: 'A01',
      orderType: 'DINE_IN',
      status: 'PENDING_ACCEPTANCE',
      itemAmountVnd: total,
      deliveryFeeVnd: '0',
      totalAmountVnd: total,
      settlementStatus: 'UNSETTLED',
      createdAt: now,
      updatedAt: now,
      table: { id: tableId, tableNo: 'A01', tableName: '演示桌 A01' },
      items: selected,
    };
    orders.unshift(order);
    return mutationResult(order);
  },
  decreaseOrderItem(
    orderId: string,
    itemId: string,
    input: DecreaseMerchantOrderItemInput,
  ): MerchantOrderMutationResult {
    const cached = adjustmentResults.get(`${orderId}:${input.requestKey}`);
    if (cached) return structuredClone(cached);
    const order = requireOrder(orderId);
    requireOpenDemoSession(order);
    if (order.status !== 'PENDING_ACCEPTANCE') {
      throw conflict('ORDER_STATUS_CHANGED', 'Demo order status changed');
    }
    const item = requireOrderItem(order, itemId);
    if (item.quantity !== input.expectedQuantity) {
      throw conflict('ORDER_ITEM_QUANTITY_CHANGED', 'Demo item quantity changed');
    }
    if (input.targetQuantity < 0 || input.targetQuantity >= item.quantity) {
      throw conflict('INVALID_ITEM_QUANTITY', 'Invalid demo target quantity');
    }
    item.quantity = input.targetQuantity;
    item.subtotalVnd = (BigInt(item.unitPriceVnd ?? 0) * BigInt(item.quantity)).toString();
    if (item.quantity === 0) order.items = order.items.filter((candidate) => candidate.id !== item.id);
    if (!order.items.length) order.status = 'CANCELLED';
    recalculateDemoOrder(order);
    return cacheAdjustmentResult(order, input.requestKey);
  },
  returnOrderItem(
    orderId: string,
    itemId: string,
    input: ReturnMerchantOrderItemInput,
  ): MerchantOrderMutationResult {
    const cached = adjustmentResults.get(`${orderId}:${input.requestKey}`);
    if (cached) return structuredClone(cached);
    const order = requireOrder(orderId);
    requireOpenDemoSession(order);
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) {
      throw conflict('ORDER_STATUS_CHANGED', 'Demo order status changed');
    }
    const item = requireOrderItem(order, itemId);
    if (item.quantity !== input.expectedQuantity) {
      throw conflict('ORDER_ITEM_QUANTITY_CHANGED', 'Demo item quantity changed');
    }
    if (input.returnQuantity < 1 || input.returnQuantity > item.quantity) {
      throw conflict('INVALID_ITEM_QUANTITY', 'Invalid demo return quantity');
    }
    if (order.items.length === 1 && input.returnQuantity === item.quantity) {
      throw conflict('LAST_ORDER_ITEM_RETURN_NOT_ALLOWED', 'Cannot return the last demo item');
    }
    item.quantity -= input.returnQuantity;
    item.subtotalVnd = (BigInt(item.unitPriceVnd ?? 0) * BigInt(item.quantity)).toString();
    if (item.quantity === 0) order.items = order.items.filter((candidate) => candidate.id !== item.id);
    recalculateDemoOrder(order);
    return cacheAdjustmentResult(order, input.requestKey);
  },
};

function requireOrder(id: string) {
  const order = orders.find((item) => item.id === id);
  if (!order) throw notFound('Demo order not found');
  return order;
}

function requireOrderItem(order: MerchantOrder, itemId: string) {
  const item = order.items.find((candidate) => candidate.id === itemId);
  if (!item) throw conflict('ORDER_ITEM_NOT_FOUND', 'Demo order item not found');
  return item;
}

function requireOpenDemoTable(tableId: string) {
  if (tableId !== 'demo-table-1' || sessionClosed) {
    throw conflict('TABLE_SESSION_NOT_OPEN', 'Demo table session is not open');
  }
}

function requireOpenDemoSession(order: MerchantOrder) {
  if (sessionClosed || order.tableSessionId !== 'demo-session-1') {
    throw conflict('TABLE_SESSION_CLOSED', 'Demo table session is closed');
  }
}

function recalculateDemoOrder(order: MerchantOrder) {
  const itemTotal = order.items.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n).toString();
  order.itemAmountVnd = itemTotal;
  order.totalAmountVnd = (BigInt(itemTotal) + BigInt(order.deliveryFeeVnd)).toString();
  order.updatedAt = new Date().toISOString();
}

function mutationResult(order: MerchantOrder): MerchantOrderMutationResult {
  return { order: structuredClone(order), session: buildSessionDetail() };
}

function cacheAdjustmentResult(order: MerchantOrder, requestKey: string) {
  const result = mutationResult(order);
  adjustmentResults.set(`${order.id}:${requestKey}`, structuredClone(result));
  return result;
}

function conflict(code: string, message: string) {
  return new CashierApiError({ message, status: 409, code });
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
