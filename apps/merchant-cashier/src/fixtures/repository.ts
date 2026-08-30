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
  TransferTableSessionInput,
  BusinessDaySummary,
  CheckoutTableSessionV2Input,
  DineInCanonicalLine,
  DineInCanonicalState,
  ReconcileDineInCanonicalStateInput,
  ReleaseEmptyTableSessionInput,
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
let sessionTableId = 'demo-table-1';
let roundingApplied = false;
let sessionDiscountPayableRateBps: number | null = null;
let nextAddedOrder = 1;
let adjustmentResults = new Map<string, MerchantOrderMutationResult>();
let nextExtraSession = 2;
let extraSessions = new Map<string, {
  id: string;
  tableId: string;
  openedAt: string;
  closedAt: string | null;
}>();
let openMutationResults = new Map<string, MerchantOrderMutationResult>();
let canonicalMutationResults = new Map<string, DineInCanonicalState>();
let releaseMutationResults = new Map<string, TableSessionDetail>();

export function resetDemoRepository() {
  orders = cloneFixture(initialDemoOrders);
  sessionClosed = false;
  sessionTableId = 'demo-table-1';
  roundingApplied = false;
  sessionDiscountPayableRateBps = null;
  nextAddedOrder = 1;
  adjustmentResults = new Map();
  nextExtraSession = 2;
  extraSessions = new Map();
  openMutationResults = new Map();
  canonicalMutationResults = new Map();
  releaseMutationResults = new Map();
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
      (!filters.statuses?.length || filters.statuses.includes(order.status)) &&
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
    const settlement = settlements.find((item) => (
      item.settlementId === id || item.orderIds.includes(id)
    ));
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
  openSessions: () => [
    ...(!sessionClosed ? [buildSessionSummary()] : []),
    ...[...extraSessions.values()]
      .filter((session) => !session.closedAt)
      .map((session) => buildSessionSummary(session.id)),
  ],
  currentSession: (tableId: string) => {
    if (tableId === sessionTableId && !sessionClosed) return buildSessionSummary();
    const session = [...extraSessions.values()].find(
      (candidate) => candidate.tableId === tableId && !candidate.closedAt,
    );
    return session ? buildSessionSummary(session.id) : null;
  },
  session: (id: string) => {
    if (id !== 'demo-session-1' && !extraSessions.has(id)) throw notFound('Demo table session not found');
    return buildSessionDetail(id);
  },
  canonicalState: (id: string) => buildDemoCanonicalState(id),
  reconcileCanonicalState: (id: string, input: ReconcileDineInCanonicalStateInput) => {
    const replay = canonicalMutationResults.get(`${id}:${input.requestKey}`);
    if (replay) return { ...cloneFixture(replay), idempotentReplay: true };
    const before = buildDemoCanonicalState(id);
    if (before.revision !== input.baseRevision) {
      throw new CashierApiError({
        message: '演示桌账已被其他终端更新',
        status: 409,
        code: 'CANONICAL_REVISION_CONFLICT',
        details: { latestState: cloneFixture(before) },
      });
    }
    const desiredByKey = new Map(input.desiredItems
      .filter((item) => item.lineKey)
      .map((item) => [item.lineKey!, item.desiredQuantity]));
    const additions: Array<{ productId: string; quantity: number; remark?: string }> = [];
    for (const desired of input.desiredItems) {
      if (!desired.lineKey && desired.productId && desired.desiredQuantity > 0) {
        additions.push({ productId: desired.productId, quantity: desired.desiredQuantity, remark: desired.remark });
      }
    }
    for (const line of before.items) {
      const desiredQuantity = desiredByKey.get(line.lineKey) ?? 0;
      if (desiredQuantity < line.lockedQuantity || desiredQuantity < 0) {
        throw conflict('CANONICAL_QUANTITY_LOCKED', 'Demo canonical quantity is locked');
      }
      let removeQuantity = line.quantity - desiredQuantity;
      if (removeQuantity <= 0) {
        if (removeQuantity < 0 && line.productId) {
          additions.push({ productId: line.productId, quantity: -removeQuantity, remark: line.remark });
        }
        continue;
      }
      const candidates = demoRawItemsForLine(id, line)
        .filter(({ order }) => ['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.status));
      for (const { order, item } of candidates) {
        if (removeQuantity <= 0) break;
        const removed = Math.min(removeQuantity, item.quantity);
        item.quantity -= removed;
        item.subtotalVnd = (BigInt(item.unitPriceVnd ?? 0) * BigInt(item.quantity)).toString();
        removeQuantity -= removed;
        if (item.quantity === 0) order.items = order.items.filter((candidate) => candidate.id !== item.id);
        recalculateDemoOrder(order);
        if (!order.items.length) {
          order.status = 'CANCELLED';
          order.cancelledAt = order.updatedAt;
          order.cancelReason = 'Demo canonical order automatically cancelled after final item removal';
        }
      }
      if (removeQuantity > 0) throw conflict('CANONICAL_QUANTITY_LOCKED', 'Demo canonical quantity is locked');
    }
    if (additions.length > 0) {
      demoRepository.createTableOrder(before.tableId, {
        idempotencyKey: `${input.requestKey}:batch`,
        items: additions,
      });
    }
    if (id === 'demo-session-1') clearDemoSessionRounding();
    let after = buildDemoCanonicalState(id);
    if (after.items.length === 0 && after.totals.payableAmountVnd === '0' && after.blockers.length === 0) {
      closeDemoSession(id);
      after = buildDemoCanonicalState(id);
      after.releasedBecause = 'EMPTY_AFTER_RECONCILE';
    }
    canonicalMutationResults.set(`${id}:${input.requestKey}`, cloneFixture(after));
    return after;
  },
  releaseEmptySession: (id: string, input: ReleaseEmptyTableSessionInput) => {
    const replay = releaseMutationResults.get(`${id}:${input.requestKey}`);
    if (replay) return cloneFixture(replay);
    const state = buildDemoCanonicalState(id);
    if (state.revision !== input.expectedRevision) {
      throw new CashierApiError({ message: '演示桌账已变化', status: 409, code: 'CANONICAL_REVISION_CONFLICT', details: { latestState: cloneFixture(state) } });
    }
    if (state.items.length || state.totals.payableAmountVnd !== '0') {
      throw conflict('CANONICAL_EMPTY_RELEASE_NOT_ALLOWED', 'Demo table is not empty');
    }
    closeDemoSession(id);
    const detail = buildSessionDetail(id);
    releaseMutationResults.set(`${id}:${input.requestKey}`, cloneFixture(detail));
    return detail;
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
  transferSession: (id: string, input: TransferTableSessionInput) => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    if (sessionClosed) throw conflict('TABLE_SESSION_NOT_OPEN', 'Demo table session is closed');
    if (input.targetTableId === sessionTableId) return buildSessionDetail();
    if (input.expectedSourceTableId !== sessionTableId) {
      throw conflict('TABLE_TRANSFER_SOURCE_CHANGED', 'Demo source table changed');
    }
    const target = demoTables.find((table) => table.id === input.targetTableId);
    if (!target || target.status !== 'ACTIVE') {
      throw conflict('TABLE_TRANSFER_TARGET_NOT_AVAILABLE', 'Demo target table unavailable');
    }
    sessionTableId = target.id;
    for (const order of tableOrders()) {
      order.tableId = target.id;
      order.table = { id: target.id, tableNo: target.tableNo, tableName: target.tableName };
    }
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
  checkoutSession: (id: string, v2?: CheckoutTableSessionV2Input): TableSessionCheckoutResult => {
    if (id !== 'demo-session-1') throw notFound('Demo table session not found');
    if (sessionClosed) {
      return { session: buildSessionDetail(), orders: cloneFixture(tableOrders()) };
    }
    if (v2) {
      const state = buildDemoCanonicalState(id);
      if (state.revision !== v2.expectedRevision) {
        throw new CashierApiError({ message: '演示桌账已变化', status: 409, code: 'CANONICAL_REVISION_CONFLICT', details: { latestState: cloneFixture(state) } });
      }
      if (!state.items.length || state.totals.payableAmountVnd === '0') {
        throw conflict('CANONICAL_EMPTY_CHECKOUT_NOT_ALLOWED', 'Demo empty table cannot checkout');
      }
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
    const cachedOpen = openMutationResults.get(input.idempotencyKey);
    if (cachedOpen) return cloneFixture(cachedOpen);
    const existing = orders.find((order) =>
      order.createdByStaffId === demoStaffSession.id
      && order.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return mutationResult(existing);

    const sessionId = ensureOpenDemoTable(tableId);

    if (!input.items.length) {
      const result = { order: null, session: buildSessionDetail(sessionId) };
      openMutationResults.set(input.idempotencyKey, cloneFixture(result));
      return result;
    }

    if (sessionId === 'demo-session-1') clearDemoSessionRounding();

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
      tableSessionId: sessionId,
      tableNoSnapshot: demoTables.find((table) => table.id === tableId)?.tableNo ?? null,
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
      itemAmountVnd: total,
      deliveryFeeVnd: '0',
      totalAmountVnd: total,
      settlementStatus: 'UNSETTLED',
      createdAt: now,
      updatedAt: now,
      table: (() => {
        const table = demoTables.find((candidate) => candidate.id === tableId)!;
        return { id: table.id, tableNo: table.tableNo, tableName: table.tableName };
      })(),
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
    const sessionId = order.tableSessionId ?? 'demo-session-1';
    const effectiveQuantity = tableOrders(sessionId)
      .filter((candidate) => candidate.status !== 'CANCELLED')
      .flatMap((candidate) => candidate.items)
      .reduce((sum, candidate) => sum + candidate.quantity, 0);
    if (effectiveQuantity === 0) closeDemoSession(sessionId);
    return cacheAdjustmentResult(order, input.requestKey);
  },
};

function buildDemoCanonicalState(sessionId: string): DineInCanonicalState {
  if (sessionId !== 'demo-session-1' && !extraSessions.has(sessionId)) {
    throw notFound('Demo table session not found');
  }
  const detail = buildSessionDetail(sessionId);
  const grouped = new Map<string, DineInCanonicalLine>();
  const billableOrders = tableOrders(sessionId).filter((order) =>
    ['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED'].includes(order.status),
  );
  for (const order of billableOrders) {
    for (const item of order.items) {
      const remark = normalizeDemoText(item.remark);
      const lineKey = demoCanonicalLineKey(item, remark);
      const product = item.productId
        ? demoMenuProducts.find((candidate) => candidate.id === item.productId)
        : undefined;
      const locked = order.status === 'DELIVERING' || order.status === 'COMPLETED';
      const current = grouped.get(lineKey) ?? {
        lineKey,
        productId: item.productId ?? null,
        productNameZh: product?.nameZh ?? item.productNameZhSnapshot,
        productNameVi: product?.nameVi ?? item.productNameViSnapshot ?? null,
        productNameEn: product?.nameEn ?? null,
        remark,
        optionSignature: '',
        activeSince: order.createdAt,
        displayOrderKey: `${order.createdAt}:${item.id}:${lineKey}`,
        unitPriceVnd: item.unitPriceVnd ?? '0',
        quantity: 0,
        lockedQuantity: 0,
        adjustableQuantity: 0,
        subtotalVnd: '0',
        adjustability: 'LOCKED',
        sourceSummary: { staffQuantity: 0, qrQuantity: 0 },
      } satisfies DineInCanonicalLine;
      current.quantity += item.quantity;
      current.subtotalVnd = (BigInt(current.subtotalVnd) + BigInt(item.subtotalVnd)).toString();
      if (locked) current.lockedQuantity += item.quantity;
      else current.adjustableQuantity += item.quantity;
      if (order.createdByStaffId) current.sourceSummary.staffQuantity += item.quantity;
      else current.sourceSummary.qrQuantity += item.quantity;
      grouped.set(lineKey, current);
    }
  }
  const items = [...grouped.values()]
    .map((line) => ({
      ...line,
      adjustability: line.adjustableQuantity === 0
        ? 'LOCKED' as const
        : billableOrders.some((order) => order.status === 'PENDING_ACCEPTANCE'
          && order.items.some((item) => demoCanonicalLineKey(item, normalizeDemoText(item.remark)) === line.lineKey))
          ? 'DECREASE' as const
          : 'RETURN' as const,
    }))
    .sort((left, right) => left.activeSince.localeCompare(right.activeSince)
      || left.displayOrderKey.localeCompare(right.displayOrderKey));
  const originalAmountVnd = items.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n);
  const amounts = previewSettlementAdjustment({
    itemAmountVnd: originalAmountVnd,
    discountPayableRateBps: sessionId === 'demo-session-1' ? sessionDiscountPayableRateBps : null,
    roundingEnabled: sessionId === 'demo-session-1' && roundingApplied,
  });
  const revisionSource = {
    sessionId,
    tableId: detail.tableId,
    status: detail.status,
    discountPayableRateBps: sessionId === 'demo-session-1' ? sessionDiscountPayableRateBps : null,
    roundingApplied: sessionId === 'demo-session-1' && roundingApplied,
    orders: tableOrders(sessionId).map((order) => ({
      id: order.id,
      status: order.status,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId ?? null,
        name: item.productNameZhSnapshot,
        remark: normalizeDemoText(item.remark),
        price: item.unitPriceVnd,
        quantity: item.quantity,
      })),
    })),
  };
  return {
    sessionId,
    tableId: detail.tableId,
    tableNo: detail.tableNo,
    tableName: detail.tableName,
    openedAt: detail.openedAt,
    sessionStatus: detail.status,
    revision: `demo-dcs2:${demoHash(JSON.stringify(revisionSource))}`,
    items,
    totals: {
      originalAmountVnd: originalAmountVnd.toString(),
      discountPayableRateBps: sessionId === 'demo-session-1' ? sessionDiscountPayableRateBps : null,
      discountAmountVnd: amounts.discountAmountVnd,
      roundingAmountVnd: amounts.roundingAmountVnd,
      payableAmountVnd: amounts.payableAmountVnd,
    },
    blockers: billableOrders.some((order) => order.status === 'PENDING_ACCEPTANCE')
      ? ['UNACCEPTED_ORDER']
      : [],
    generatedAt: new Date().toISOString(),
  };
}

function demoRawItemsForLine(sessionId: string, line: DineInCanonicalLine) {
  return tableOrders(sessionId).flatMap((order) => order.items
    .filter((item) => demoCanonicalLineKey(item, normalizeDemoText(item.remark)) === line.lineKey)
    .map((item) => ({ order, item })));
}

function demoCanonicalLineKey(
  item: MerchantOrder['items'][number],
  remark: string,
) {
  const identity = item.productId ?? `historical:${normalizeDemoText(item.productNameZhSnapshot).toLowerCase()}`;
  return `demo-dline:${demoHash(JSON.stringify([identity, remark, item.unitPriceVnd ?? '0', '']))}`;
}

function normalizeDemoText(value: string | null | undefined) {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function demoHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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

function ensureOpenDemoTable(tableId: string) {
  const table = demoTables.find((candidate) => candidate.id === tableId);
  if (!table || table.status !== 'ACTIVE') {
    throw conflict('TABLE_NOT_AVAILABLE', 'Demo table is not available');
  }
  if (tableId === sessionTableId && !sessionClosed) return 'demo-session-1';
  const existing = [...extraSessions.values()].find(
    (session) => session.tableId === tableId && !session.closedAt,
  );
  if (existing) return existing.id;
  const session = {
    id: `demo-session-${nextExtraSession++}`,
    tableId,
    openedAt: new Date().toISOString(),
    closedAt: null,
  };
  extraSessions.set(session.id, session);
  return session.id;
}

function requireOpenDemoSession(order: MerchantOrder) {
  const primaryClosed = order.tableSessionId === 'demo-session-1' && sessionClosed;
  const extraSession = order.tableSessionId === 'demo-session-1'
    ? null
    : extraSessions.get(order.tableSessionId ?? '');
  if (primaryClosed || (order.tableSessionId !== 'demo-session-1' && (!extraSession || extraSession.closedAt))) {
    throw conflict('TABLE_SESSION_CLOSED', 'Demo table session is closed');
  }
}

function closeDemoSession(sessionId: string) {
  if (sessionId === 'demo-session-1') {
    sessionClosed = true;
    return;
  }
  const session = extraSessions.get(sessionId);
  if (session) session.closedAt = new Date().toISOString();
}

function recalculateDemoOrder(order: MerchantOrder) {
  const itemTotal = order.items.reduce((sum, item) => sum + BigInt(item.subtotalVnd), 0n).toString();
  order.itemAmountVnd = itemTotal;
  order.totalAmountVnd = (BigInt(itemTotal) + BigInt(order.deliveryFeeVnd)).toString();
  order.updatedAt = new Date().toISOString();
}

function mutationResult(order: MerchantOrder): MerchantOrderMutationResult {
  return { order: cloneFixture(order), session: buildSessionDetail(order.tableSessionId ?? 'demo-session-1') };
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

function tableOrders(sessionId = 'demo-session-1') {
  const sessionOrders = orders.filter((order) => order.tableSessionId === sessionId);
    return import.meta.env.VITE_CASHIER_LARGE_AMOUNT_FIXTURE === 'true'
    ? sessionOrders.filter((order) => ['demo-order-1001', 'demo-order-1006'].includes(order.id))
    : sessionOrders;
}

function clearDemoSessionRounding() {
  roundingApplied = false;
  sessionDiscountPayableRateBps = null;
}

function buildSessionSummary(sessionId = 'demo-session-1'): TableSessionSummary {
  const related = tableOrders(sessionId);
  const billable = related.filter((order) => order.status !== 'CANCELLED');
  const unfinished = related.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status));
  const firstOpenedOrder = related[related.length - 1];
  const totalAmountVnd = billable.reduce((sum, order) => sum + BigInt(order.totalAmountVnd), 0n);
  const extraSession = extraSessions.get(sessionId);
  const tableId = extraSession?.tableId ?? sessionTableId;
  const table = demoTables.find((candidate) => candidate.id === tableId) ?? demoTables[0]!;
  const isPrimary = sessionId === 'demo-session-1';
  const sessionRoundingApplied = isPrimary ? roundingApplied : false;
  const sessionDiscountRate = isPrimary ? sessionDiscountPayableRateBps : null;
  const sessionClosedState = isPrimary ? sessionClosed : Boolean(extraSession?.closedAt);
  const sessionOpenedAt = extraSession?.openedAt ?? firstOpenedOrder?.createdAt ?? new Date().toISOString();
  const amounts = previewSettlementAdjustment({
    itemAmountVnd: totalAmountVnd,
    discountPayableRateBps: sessionDiscountRate,
    roundingEnabled: sessionRoundingApplied,
  });
  return {
    id: sessionId, sessionNo: `DEMO-SESSION-${sessionId.replace('demo-session-', '')}`, merchantId: 'demo-merchant', tableId: table.id, tableNo: table.tableNo, tableName: table.tableName, status: sessionClosedState ? 'CLOSED' : 'OPEN', openedAt: sessionOpenedAt, closedAt: isPrimary ? (sessionClosedState ? new Date().toISOString() : null) : extraSession?.closedAt ?? null,
    orderCount: billable.length, itemCount: billable.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0), totalAmountVnd: totalAmountVnd.toString(), originalAmountVnd: totalAmountVnd.toString(), discountPayableRateBps: sessionDiscountRate, discountAmountVnd: amounts.discountAmountVnd, discountAppliedByStaffId: sessionDiscountRate === null ? null : demoStaffSession.id, discountAppliedAt: sessionDiscountRate === null ? null : new Date().toISOString(), roundingApplied: sessionRoundingApplied, roundingAmountVnd: amounts.roundingAmountVnd, payableAmountVnd: amounts.payableAmountVnd, latestOrderAt: related[0]?.createdAt ?? null, pendingOrderCount: related.filter((order) => order.status === 'PENDING_ACCEPTANCE').length, unfinishedOrderCount: unfinished.length,
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

function buildSessionDetail(sessionId = 'demo-session-1'): TableSessionDetail {
  return {
    ...buildSessionSummary(sessionId),
    orders: tableOrders(sessionId).map((order) => ({ id: order.id, orderNo: order.orderNo, createdByStaffId: order.createdByStaffId, status: order.status, createdAt: order.createdAt, itemAmountVnd: order.itemAmountVnd, deliveryFeeVnd: order.deliveryFeeVnd, totalAmountVnd: order.totalAmountVnd, tableNoSnapshot: order.tableNoSnapshot, items: order.items.map((item) => ({ id: item.id, productId: item.productId, productNameZhSnapshot: item.productNameZhSnapshot, productNameViSnapshot: item.productNameViSnapshot, productNameEnSnapshot: item.productNameEnSnapshot, productNameZh: item.productNameZh, productNameVi: item.productNameVi, productNameEn: item.productNameEn, quantity: item.quantity, unitPriceVnd: item.unitPriceVnd ?? '0', subtotalVnd: item.subtotalVnd })) })),
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
