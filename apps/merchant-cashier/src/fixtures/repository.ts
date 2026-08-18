import { canRunOrderAction } from '@/domain';
import { previewSettlementAdjustment } from '@/domain/settlement-adjustment';
import type {
  CreateMerchantTableOrderInput,
  DecreaseMerchantOrderItemInput,
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
  MerchantOrderMutationResult,
  MerchantSettlement,
  MerchantSettlementFilters,
  MerchantSettlementItem,
  MerchantSettlementPage,
  MerchantSettlementSourceOrder,
  ReturnMerchantOrderItemInput,
  SettlementAdjustmentInput,
  TableSessionCheckoutResult,
  TableSessionDetail,
  TableSessionSummary,
  BusinessDaySummary,
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
import { resetDemoChatRepository } from './chat';

function cloneFixture<T>(value: T): T {
  // Fixture values are JSON data (no Date, Map, Set, Blob or cyclic values).
  // JSON cloning keeps demo mode compatible with Chromium 83 without adding a
  // global polyfill to the real cashier runtime.
  return JSON.parse(JSON.stringify(value)) as T;
}

let orders = cloneFixture(initialDemoOrders);
let sessionClosed = false;
let roundingApplied = false;
let sessionDiscountPayableRateBps: number | null = null;
let nextAddedOrder = 1;
let adjustmentResults = new Map<string, MerchantOrderMutationResult>();

export function resetDemoRepository() {
  orders = cloneFixture(initialDemoOrders);
  sessionClosed = false;
  roundingApplied = false;
  sessionDiscountPayableRateBps = null;
  nextAddedOrder = 1;
  adjustmentResults = new Map();
  resetDemoChatRepository();
}

export const demoRepository = {
  staff: () => cloneFixture(demoStaffSession),
  profile: () => cloneFixture(demoMerchantProfile),
  categories: () => cloneFixture(demoMenuCategories),
  products: () => cloneFixture(demoMenuProducts),
  orders: (filters: MerchantOrderFilters = {}) => cloneFixture(
    orders.filter((order) =>
      (!filters.status || order.status === filters.status) &&
      (!filters.orderType || order.orderType === filters.orderType),
    ),
  ),
  settlements: (filters: MerchantSettlementFilters = {}): MerchantSettlementPage => {
    const scope = orders.filter((order) =>
      (order.status === 'COMPLETED' || order.status === 'CANCELLED') &&
      (!filters.status || order.status === filters.status) &&
      (!filters.orderType || order.orderType === filters.orderType),
    );
    const settlements = buildDemoSettlements(scope);
    const filtered = filters.search?.trim()
      ? settlements.filter((settlement) => {
          const keyword = filters.search!.trim().toLowerCase();
          return settlement.orderNos.some((orderNo) =>
            orderNo.toLowerCase().includes(keyword),
          ) || settlement.orderIds.some((orderId) => orderId.includes(keyword));
        })
      : settlements;
    const total = filtered.length;
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const start = (page - 1) * pageSize;
    return {
      items: cloneFixture(filtered.slice(start, start + pageSize)),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  },
  settlement: (id: string): MerchantSettlement => {
    const settlements = buildDemoSettlements(orders.filter(
      (order) => order.status === 'COMPLETED' || order.status === 'CANCELLED',
    ));
    const settlement = settlements.find((item) => item.settlementId === id);
    if (!settlement) {
      throw new CashierApiError({ message: '结账记录不存在', status: 404, code: 'HTTP_404' });
    }
    return cloneFixture(settlement);
  },
  businessDaySummary: (businessDate?: string) => cloneFixture(
    buildBusinessDaySummary(businessDate),
  ),
  order: (id: string) => cloneFixture(requireOrder(id)),
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
    return cloneFixture(order);
  },
  setOrderRounding(id: string, enabled: boolean) {
    const order = requireOrder(id);
    if (!['PICKUP', 'DELIVERY'].includes(order.orderType)) {
      throw conflict('ORDER_ROUNDING_ORDER_TYPE_NOT_ALLOWED', 'Only pickup and delivery orders can be rounded');
    }
    if (!['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) {
      throw conflict('ORDER_ROUNDING_STATUS_NOT_ALLOWED', 'This order cannot be rounded');
    }
    return applyDemoOrderSettlement(order, {
      discountPayableRateBps: order.discountPayableRateBps ?? null,
      roundingEnabled: enabled,
    });
  },
  setOrderSettlementAdjustment(id: string, input: SettlementAdjustmentInput) {
    const order = requireOrder(id);
    if (!['PICKUP', 'DELIVERY'].includes(order.orderType)) {
      throw conflict('ORDER_ROUNDING_ORDER_TYPE_NOT_ALLOWED', 'Only pickup and delivery orders can receive adjustments');
    }
    if (order.settlementStatus !== 'UNSETTLED') {
      throw conflict('ORDER_ROUNDING_ALREADY_SETTLED', 'This order is settled');
    }
    return applyDemoOrderSettlement(order, input);
  },
  tables: () => cloneFixture(demoTables),
  openSessions: () => sessionClosed ? [] : [buildSessionSummary()],
  currentSession: (tableId: string) =>
    tableId === 'demo-table-1' && !sessionClosed ? buildSessionSummary() : null,
  session: (id: string) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    return buildSessionDetail();
  },
  setSessionRounding: (id: string, enabled: boolean) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    if (sessionClosed) throw conflict('TABLE_SESSION_CLOSED', 'Demo table session is closed');
    roundingApplied = enabled;
    return buildSessionDetail();
  },
  setSessionSettlementAdjustment: (id: string, input: SettlementAdjustmentInput) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    if (sessionClosed) throw conflict('TABLE_SESSION_CLOSED', 'Demo table session is closed');
    sessionDiscountPayableRateBps = input.discountPayableRateBps;
    roundingApplied = input.roundingEnabled;
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
  checkoutSession: (id: string): TableSessionCheckoutResult => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    if (sessionClosed) {
      return { session: buildSessionDetail(), orders: cloneFixture(tableOrders()) };
    }
    if (tableOrders().some((order) => order.status === 'PENDING_ACCEPTANCE')) {
      throw conflict('TABLE_SESSION_HAS_UNACCEPTED_ORDERS', 'Demo table has unaccepted orders');
    }
    const originalAmountVnd = tableOrders()
      .filter((order) => order.status !== 'CANCELLED')
      .reduce((sum, order) => sum + BigInt(order.totalAmountVnd), 0n);
    const amounts = previewSettlementAdjustment({
      itemAmountVnd: originalAmountVnd,
      discountPayableRateBps: sessionDiscountPayableRateBps,
      roundingEnabled: roundingApplied,
    });
    const completedAt = new Date().toISOString();
    for (const order of tableOrders()) {
      if (['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) {
        const fromStatus = order.status;
        order.status = 'COMPLETED';
        order.completedAt = completedAt;
        order.updatedAt = completedAt;
        order.statusLogs = [
          ...(order.statusLogs ?? []),
          {
            id: `${order.id}-table-checkout`,
            action: 'TABLE_SESSION_CHECKOUT',
            fromStatus,
            toStatus: 'COMPLETED',
            operatorType: 'MERCHANT_STAFF',
            operatorStaffId: demoStaffSession.id,
            remark: '桌台结账，订单自动完成',
            createdAt: completedAt,
            metadata: {
              tableSessionId: 'demo-session-1',
              originalAmountVnd: originalAmountVnd.toString(),
              itemAmountVnd: originalAmountVnd.toString(),
              discountPayableRateBps: sessionDiscountPayableRateBps,
              discountAmountVnd: amounts.discountAmountVnd,
              afterDiscountAmountVnd: amounts.afterDiscountAmountVnd,
              nonDiscountableFeeVnd: '0',
              roundingAmountVnd: amounts.roundingAmountVnd,
              finalPayableAmountVnd: amounts.payableAmountVnd,
              payableAmountVnd: amounts.payableAmountVnd,
            },
          },
        ];
      }
    }
    sessionClosed = true;
    return { session: buildSessionDetail(), orders: cloneFixture(tableOrders()) };
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

    clearDemoSessionRounding();

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
      status: 'ACCEPTED',
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
    if (cached) return cloneFixture(cached);
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
    clearDemoSessionRounding();
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
    if (cached) return cloneFixture(cached);
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
    clearDemoSessionRounding();
    item.quantity -= input.returnQuantity;
    item.subtotalVnd = (BigInt(item.unitPriceVnd ?? 0) * BigInt(item.quantity)).toString();
    if (item.quantity === 0) order.items = order.items.filter((candidate) => candidate.id !== item.id);
    recalculateDemoOrder(order);
    if (!order.items.length) {
      order.status = 'CANCELLED';
      order.cancelledAt = order.updatedAt;
      order.cancelReason = 'Demo order automatically cancelled after its final item was returned';
    }
    const effectiveQuantity = tableOrders()
      .filter((candidate) => candidate.status !== 'CANCELLED')
      .flatMap((candidate) => candidate.items)
      .reduce((sum, candidate) => sum + candidate.quantity, 0);
    if (effectiveQuantity === 0) sessionClosed = true;
    return cacheAdjustmentResult(order, input.requestKey);
  },
};

function buildBusinessDaySummary(requestedDate?: string): BusinessDaySummary {
  const businessDate = requestedDate || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const completed = orders.filter((order) => order.status === 'COMPLETED');
  const itemMap = new Map<string, number>();
  for (const order of completed) {
    for (const item of order.items) {
      itemMap.set(
        item.productNameZhSnapshot,
        (itemMap.get(item.productNameZhSnapshot) ?? 0) + item.quantity,
      );
    }
  }
  const totalRevenueVnd = completed.reduce(
    (sum, order) => sum + BigInt(order.payableAmountVnd ?? order.totalAmountVnd),
    0n,
  );
  return {
    merchant: {
      id: demoMerchantProfile.id,
      nameZh: demoMerchantProfile.nameZh,
      nameVi: demoMerchantProfile.nameVi,
    },
    businessDate,
    segments: [{ start: '00:00', end: '23:59', crossesMidnight: false }],
    orderCount: completed.length,
    itemSummary: [...itemMap].map(([nameZh, quantity]) => ({ nameZh, quantity })),
    discountAmountVnd: completed.reduce(
      (sum, order) => sum + BigInt(order.discountAmountVnd ?? '0'),
      0n,
    ).toString(),
    roundingAmountVnd: completed.reduce(
      (sum, order) => sum + BigInt(order.roundingAmountVnd ?? '0'),
      0n,
    ).toString(),
    totalRevenueVnd: totalRevenueVnd.toString(),
    cashRevenueVnd: '0',
    bankTransferRevenueVnd: '0',
    unrecordedRevenueVnd: totalRevenueVnd.toString(),
    generatedAt: new Date().toISOString(),
  };
}

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
  return { order: cloneFixture(order), session: buildSessionDetail() };
}

function cacheAdjustmentResult(order: MerchantOrder, requestKey: string) {
  const result = mutationResult(order);
  adjustmentResults.set(`${order.id}:${requestKey}`, cloneFixture(result));
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
  const sessionOrders = orders.filter((order) => order.tableSessionId === 'demo-session-1');
    return import.meta.env.VITE_CASHIER_LARGE_AMOUNT_FIXTURE === 'true'
    ? sessionOrders.filter((order) => ['demo-order-1001', 'demo-order-1006'].includes(order.id))
    : sessionOrders;
}

function clearDemoSessionRounding() {
  roundingApplied = false;
  sessionDiscountPayableRateBps = null;
}

function buildSessionSummary(): TableSessionSummary {
  const related = tableOrders();
  const billable = related.filter((order) => order.status !== 'CANCELLED');
  const unfinished = related.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status));
  const firstOpenedOrder = related[related.length - 1];
  const totalAmountVnd = billable.reduce((sum, order) => sum + BigInt(order.totalAmountVnd), 0n);
  const amounts = previewSettlementAdjustment({
    itemAmountVnd: totalAmountVnd,
    discountPayableRateBps: sessionDiscountPayableRateBps,
    roundingEnabled: roundingApplied,
  });
  return {
    id: 'demo-session-1', sessionNo: 'DEMO-SESSION-1', merchantId: 'demo-merchant', tableId: 'demo-table-1', tableNo: 'A01', tableName: '演示桌 A01', status: sessionClosed ? 'CLOSED' : 'OPEN', openedAt: firstOpenedOrder?.createdAt ?? new Date().toISOString(), closedAt: sessionClosed ? new Date().toISOString() : null,
    orderCount: billable.length, itemCount: billable.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0), totalAmountVnd: totalAmountVnd.toString(), originalAmountVnd: totalAmountVnd.toString(), discountPayableRateBps: sessionDiscountPayableRateBps, discountAmountVnd: amounts.discountAmountVnd, discountAppliedByStaffId: sessionDiscountPayableRateBps === null ? null : demoStaffSession.id, discountAppliedAt: sessionDiscountPayableRateBps === null ? null : new Date().toISOString(), roundingApplied, roundingAmountVnd: amounts.roundingAmountVnd, payableAmountVnd: amounts.payableAmountVnd, latestOrderAt: related[0]?.createdAt ?? null, pendingOrderCount: related.filter((order) => order.status === 'PENDING_ACCEPTANCE').length, unfinishedOrderCount: unfinished.length,
  };
}

function applyDemoOrderSettlement(
  order: MerchantOrder,
  input: SettlementAdjustmentInput,
) {
  const amounts = previewSettlementAdjustment({
    itemAmountVnd: order.itemAmountVnd,
    nonDiscountableFeeVnd: order.orderType === 'DELIVERY'
      ? order.deliveryFeeVnd
      : '0',
    discountPayableRateBps: input.discountPayableRateBps,
    roundingEnabled: input.roundingEnabled,
  });
  const now = new Date().toISOString();
  order.originalAmountVnd = order.totalAmountVnd;
  order.discountPayableRateBps = input.discountPayableRateBps;
  order.discountAmountVnd = amounts.discountAmountVnd;
  order.discountAppliedByStaffId = input.discountPayableRateBps === null
    ? null
    : demoStaffSession.id;
  order.discountAppliedAt = input.discountPayableRateBps === null ? null : now;
  order.roundingAmountVnd = amounts.roundingAmountVnd;
  order.payableAmountVnd = amounts.payableAmountVnd;
  order.roundingApplied = input.roundingEnabled;
  order.roundingAppliedByStaffId = input.roundingEnabled ? demoStaffSession.id : null;
  order.roundingAppliedAt = input.roundingEnabled ? now : null;
  order.updatedAt = now;
  return cloneFixture(order);
}

function buildSessionDetail(): TableSessionDetail {
  return {
    ...buildSessionSummary(),
    orders: tableOrders().map((order) => ({ id: order.id, orderNo: order.orderNo, createdByStaffId: order.createdByStaffId, status: order.status, createdAt: order.createdAt, itemAmountVnd: order.itemAmountVnd, deliveryFeeVnd: order.deliveryFeeVnd, totalAmountVnd: order.totalAmountVnd, tableNoSnapshot: order.tableNoSnapshot, items: order.items.map((item) => ({ id: item.id, productNameZhSnapshot: item.productNameZhSnapshot, productNameViSnapshot: item.productNameViSnapshot, productNameEnSnapshot: item.productNameEnSnapshot, productNameZh: item.productNameZh, productNameVi: item.productNameVi, productNameEn: item.productNameEn, quantity: item.quantity, unitPriceVnd: item.unitPriceVnd ?? '0', subtotalVnd: item.subtotalVnd })) })),
  };
}

function notFound(message: string) {
  return new CashierApiError({ message, status: 404, code: 'HTTP_404' });
}

function demoItem(item: MerchantOrder['items'][number]): MerchantSettlementItem {
  return {
    id: item.id,
    productId: item.productId ?? null,
    productNameZh: item.productNameZhSnapshot,
    productNameVi: item.productNameViSnapshot ?? item.productNameVi ?? null,
    productNameEn: item.productNameEnSnapshot ?? item.productNameEn ?? null,
    imageUrl: item.imageUrlSnapshot ?? null,
    unitPriceVnd: item.unitPriceVnd ?? '0',
    quantity: item.quantity,
    subtotalVnd: item.subtotalVnd,
    remark: item.remark ?? null,
  };
}

function demoSettlementSourceOrder(order: MerchantOrder): MerchantSettlementSourceOrder {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    createdAt: order.createdAt,
    completedAt: order.completedAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
    totalAmountVnd: order.totalAmountVnd,
    paymentMethod: order.paymentMethod ?? null,
  };
}

function buildDemoSettlements(orders: MerchantOrder[]): MerchantSettlement[] {
  const sessions = new Map<string, MerchantOrder[]>();
  for (const order of orders) {
    if (order.orderType === 'DINE_IN' && order.tableSessionId) {
      const group = sessions.get(order.tableSessionId) ?? [];
      group.push(order);
      sessions.set(order.tableSessionId, group);
    }
  }
  const settlements: MerchantSettlement[] = [];
  for (const [sessionId, group] of sessions) {
    const completed = group.filter((order) => order.status === 'COMPLETED');
    if (!completed.length) continue;
    const originalAmountVnd = completed.reduce(
      (sum, order) => sum + BigInt(order.totalAmountVnd),
      0n,
    );
    const roundingAmountVnd = BigInt(completed[0]?.roundingAmountVnd ?? '0');
    const representative = completed[0]!;
    const settledAt = representative.completedAt ?? representative.updatedAt;
    settlements.push({
      settlementId: `session:${sessionId}`,
      kind: 'TABLE_SESSION',
      orderType: 'DINE_IN',
      status: 'COMPLETED',
      businessDate: representative.businessDate ?? '',
      settledAt,
      tableSessionId: sessionId,
      tableId: representative.tableId ?? null,
      tableName: representative.tableNoSnapshot ?? representative.table?.tableName ?? null,
      orderIds: completed.map((order) => order.id),
      orderNos: completed.map((order) => order.orderNo),
      orderCount: completed.length,
      itemQuantity: completed.flatMap((order) => order.items)
        .reduce((sum, item) => sum + item.quantity, 0),
      items: completed.flatMap((order) => order.items.map(demoItem)),
      originalAmountVnd: originalAmountVnd.toString(),
      discountAmountVnd: '0',
      roundingAmountVnd: roundingAmountVnd.toString(),
      finalReceivableVnd: (originalAmountVnd - roundingAmountVnd).toString(),
      paymentMethod: representative.paymentMethod ?? null,
      sourceOrders: group.map(demoSettlementSourceOrder),
      invariantViolations: [],
    });
  }
  const sessionKeys = new Set(sessions.keys());
  for (const order of orders) {
    const inClosedSession =
      order.orderType === 'DINE_IN' &&
      order.tableSessionId != null &&
      sessionKeys.has(order.tableSessionId);
    if (inClosedSession) continue;
    const totalAmountVnd = BigInt(order.totalAmountVnd);
    const roundingAmountVnd = BigInt(order.roundingAmountVnd ?? '0');
    const discountAmountVnd = BigInt(order.discountAmountVnd ?? '0');
    settlements.push({
      settlementId: `order:${order.id}`,
      kind: 'ORDER',
      orderType: order.orderType,
      status: order.status,
      businessDate: order.businessDate ?? '',
      settledAt: order.completedAt ?? order.cancelledAt ?? order.updatedAt,
      tableSessionId: order.tableSessionId ?? null,
      tableId: order.tableId ?? null,
      tableName: order.tableNoSnapshot ?? order.table?.tableName ?? null,
      orderIds: [order.id],
      orderNos: [order.orderNo],
      orderCount: 1,
      itemQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      items: order.items.map(demoItem),
      originalAmountVnd: totalAmountVnd.toString(),
      discountAmountVnd: discountAmountVnd.toString(),
      roundingAmountVnd: roundingAmountVnd.toString(),
      finalReceivableVnd: (totalAmountVnd - discountAmountVnd - roundingAmountVnd).toString(),
      paymentMethod: order.paymentMethod ?? null,
      sourceOrders: [demoSettlementSourceOrder(order)],
      invariantViolations: [],
    });
  }
  return settlements.sort(
    (left, right) =>
      new Date(right.settledAt).getTime() - new Date(left.settledAt).getTime() ||
      right.settlementId.localeCompare(left.settlementId),
  );
}
