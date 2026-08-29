import { computed, ref, watch } from 'vue';
import {
  CashierApiError,
  createMerchantTableOrder,
  isDefinitiveMutationRejection,
} from '@/api';
import { createMutationKey, productDirectMergeKey } from '@/domain';
import type {
  CashierMenuProduct,
  CashierOrderingDraftLine,
  CreateMerchantTableOrderInput,
  MerchantOrderMutationResult,
} from '@/types';

const MAX_PENDING_QUANTITY_PER_PRODUCT = 12;

type IntentStatus = 'QUEUED' | 'IN_FLIGHT' | 'UNCERTAIN';

interface BaseIntent {
  id: string;
  tableId: string;
  productId: string;
  mergeKey: string;
  status: IntentStatus;
  quantity: number;
}

export interface TableOrderAddIntent extends BaseIntent {
  kind: 'ADD';
  lineId: string;
  product: CashierMenuProduct;
  firstAddedAt: string;
  firstAddedSequence: number;
  sourceItemId?: string;
  remark?: string;
  payload: CreateMerchantTableOrderInput;
}

export interface TableOrderDecreaseIntent extends BaseIntent {
  kind: 'DECREASE';
  requestKey: string;
}

export type TableOrderMutationIntent = TableOrderAddIntent | TableOrderDecreaseIntent;

export interface TableOrderDecreaseExecution {
  tableId: string;
  productId: string;
  mergeKey: string;
  requestKey: string;
  quantity: number;
}

export interface TableOrderDecreaseExecutionResult {
  result: MerchantOrderMutationResult;
  appliedQuantity: number;
}

export interface TableOrderMutationControllerOptions {
  tableId: () => string;
  sessionId: () => string;
  disabled: () => boolean;
  orderableProducts: () => CashierMenuProduct[];
  executeDecrease: (input: TableOrderDecreaseExecution) => Promise<TableOrderDecreaseExecutionResult>;
  onResult: (result: MerchantOrderMutationResult, intent: TableOrderMutationIntent | null) => void | Promise<void>;
  onFailure: (error: unknown, intent: TableOrderMutationIntent | null) => void | Promise<void>;
  onBackpressure?: (productId: string) => void;
}

/**
 * Stable page-level owner for table order writes. UI components enqueue desired
 * quantity changes; idempotency, ordered coalescing, optimistic presentation and
 * retry all remain alive even while the menu workspace is unmounted.
 */
export function useTableOrderMutationController(options: TableOrderMutationControllerOptions) {
  const intents = ref<TableOrderMutationIntent[]>([]);
  const effectiveSessionId = ref(options.sessionId());
  const pendingOpenPayload = ref<CreateMerchantTableOrderInput | null>(null);
  const activeLanes = new Set<string>();
  const flushWaiters = new Set<(settled: boolean) => void>();
  let openingPromise: Promise<boolean> | null = null;
  let nextSequence = 0;

  const orderableProductById = computed(() => new Map(
    options.orderableProducts().map((product) => [product.id, product]),
  ));
  const mutationPending = computed(() => Boolean(intents.value.length || pendingOpenPayload.value));
  const mutationLocked = computed(() => intents.value.some((intent) => intent.status === 'UNCERTAIN'));
  const draftLines = computed<CashierOrderingDraftLine[]>(() => {
    const grouped = new Map<string, CashierOrderingDraftLine>();
    for (const intent of intents.value) {
      if (intent.kind !== 'ADD') continue;
      const current = grouped.get(intent.mergeKey);
      if (current) {
        current.quantity += intent.quantity;
        continue;
      }
      grouped.set(intent.mergeKey, {
        lineId: intent.lineId,
        mergeKey: intent.mergeKey,
        product: intent.product,
        quantity: intent.quantity,
        firstAddedAt: intent.firstAddedAt,
        firstAddedSequence: intent.firstAddedSequence,
        ...(intent.sourceItemId ? { sourceItemId: intent.sourceItemId } : {}),
        ...(intent.remark ? { remark: intent.remark } : {}),
      });
    }
    return [...grouped.values()];
  });
  const pendingAddQuantities = computed<Record<string, number>>(() => {
    const quantities: Record<string, number> = {};
    for (const intent of intents.value) {
      if (intent.kind === 'ADD') quantities[intent.productId] = (quantities[intent.productId] || 0) + intent.quantity;
    }
    return quantities;
  });
  const pendingDecreaseMergeKeys = computed(() => new Set(
    intents.value.filter((intent) => intent.kind === 'DECREASE').map((intent) => intent.mergeKey),
  ));
  const pendingDecreaseQuantities = computed<Record<string, number>>(() => {
    const quantities: Record<string, number> = {};
    for (const intent of intents.value) {
      if (intent.kind === 'DECREASE') quantities[intent.mergeKey] = (quantities[intent.mergeKey] || 0) + intent.quantity;
    }
    return quantities;
  });
  const uncertainDecreaseMergeKeys = computed(() => new Set(
    intents.value
      .filter((intent) => intent.kind === 'DECREASE' && intent.status === 'UNCERTAIN')
      .map((intent) => intent.mergeKey),
  ));
  const uncertainDecreaseIntent = computed(() => intents.value.find(
    (intent): intent is TableOrderDecreaseIntent => intent.kind === 'DECREASE' && intent.status === 'UNCERTAIN',
  ) || null);

  watch(options.sessionId, (sessionId) => {
    if (sessionId) effectiveSessionId.value = sessionId;
  });
  watch(options.tableId, (tableId, previousTableId) => {
    if (tableId === previousTableId || mutationLocked.value) return;
    effectiveSessionId.value = options.sessionId();
    pendingOpenPayload.value = null;
  });

  function touchIntents() {
    intents.value = [...intents.value];
    notifyFlushWaiters();
  }

  function productPendingQuantity(productId: string) {
    return intents.value
      .filter((intent) => intent.productId === productId)
      .reduce((total, intent) => total + intent.quantity, 0);
  }

  function atCapacity(productId: string) {
    return productPendingQuantity(productId) >= MAX_PENDING_QUANTITY_PER_PRODUCT;
  }

  function removeIntent(id: string) {
    intents.value = intents.value.filter((intent) => intent.id !== id);
    notifyFlushWaiters();
  }

  function rollbackTableIntents(tableId: string) {
    intents.value = intents.value.filter((intent) => intent.tableId !== tableId);
    notifyFlushWaiters();
  }

  function settledState() {
    if (mutationLocked.value) return false;
    if (mutationPending.value) return null;
    return true;
  }

  function notifyFlushWaiters() {
    const state = settledState();
    if (state == null) return;
    flushWaiters.forEach((resolve) => resolve(state));
    flushWaiters.clear();
  }

  async function ensureTableSession(intent: TableOrderMutationIntent) {
    if (effectiveSessionId.value || options.sessionId()) return true;
    if (openingPromise) return openingPromise;
    pendingOpenPayload.value ??= {
      idempotencyKey: createMutationKey('add'),
      items: [],
    };
    const payload = pendingOpenPayload.value;
    const resumeOpenIntents = () => {
      const productIds = new Set<string>();
      intents.value.forEach((candidate) => {
        if (candidate.tableId !== intent.tableId || candidate.status !== 'UNCERTAIN') return;
        candidate.status = 'QUEUED';
        productIds.add(candidate.productId);
      });
      touchIntents();
      queueMicrotask(() => productIds.forEach((productId) => void drainLane(productId)));
    };
    openingPromise = createMerchantTableOrder(intent.tableId, payload)
      .then(async (result) => {
        effectiveSessionId.value = result.session.id;
        pendingOpenPayload.value = null;
        notifyFlushWaiters();
        await options.onResult(result, null);
        resumeOpenIntents();
        return true;
      })
      .catch(async (error) => {
        if (error instanceof CashierApiError && error.code === 'TABLE_ALREADY_OPEN') {
          effectiveSessionId.value = 'OPEN_SESSION_CONFIRMED_BY_SERVER';
          pendingOpenPayload.value = null;
          notifyFlushWaiters();
          resumeOpenIntents();
          return true;
        }
        await options.onFailure(error, null);
        if (isDefinitiveMutationRejection(error)) {
          pendingOpenPayload.value = null;
          rollbackTableIntents(intent.tableId);
        } else {
          intents.value.forEach((candidate) => {
            if (candidate.tableId === intent.tableId) candidate.status = 'UNCERTAIN';
          });
          touchIntents();
        }
        return false;
      })
      .finally(() => {
        openingPromise = null;
      });
    return openingPromise;
  }

  async function executeIntent(intent: TableOrderMutationIntent) {
    if (intent.kind === 'ADD') {
      return {
        result: await createMerchantTableOrder(intent.tableId, intent.payload),
        appliedQuantity: intent.quantity,
      };
    }
    return options.executeDecrease({
      tableId: intent.tableId,
      productId: intent.productId,
      mergeKey: intent.mergeKey,
      requestKey: intent.requestKey,
      quantity: intent.quantity,
    });
  }

  async function drainLane(productId: string) {
    if (activeLanes.has(productId)) return;
    activeLanes.add(productId);
    try {
      while (true) {
        const intent = intents.value.find((candidate) =>
          candidate.productId === productId && candidate.status === 'QUEUED',
        );
        if (!intent) break;
        intent.status = 'IN_FLIGHT';
        touchIntents();
        let execution: { result: MerchantOrderMutationResult; appliedQuantity: number };
        try {
          if (!(await ensureTableSession(intent))) break;
          execution = await executeIntent(intent);
        } catch (error) {
          await options.onFailure(error, intent);
          if (isDefinitiveMutationRejection(error)) {
            removeIntent(intent.id);
            continue;
          }
          intent.status = 'UNCERTAIN';
          touchIntents();
          break;
        }
        const appliedQuantity = Math.min(intent.quantity, Math.max(0, execution.appliedQuantity));
        if (!appliedQuantity) {
          await options.onFailure(new CashierApiError({
            message: 'The mutation did not apply any quantity.',
            status: 409,
            code: 'ORDER_ITEM_QUANTITY_CHANGED',
          }), intent);
          removeIntent(intent.id);
          continue;
        }
        effectiveSessionId.value = execution.result.session.id;
        const appliedIntent = { ...intent, quantity: appliedQuantity } as TableOrderMutationIntent;
        const hasDecreaseRemainder = intent.kind === 'DECREASE' && appliedQuantity < intent.quantity;
        if (hasDecreaseRemainder && intent.kind === 'DECREASE') {
          intent.quantity -= appliedQuantity;
          intent.requestKey = createMutationKey('decrease');
          intent.status = 'QUEUED';
          touchIntents();
        } else {
          // Retire the optimistic quantity before applying the canonical snapshot
          // so Vue observes one atomic desired quantity rather than a double count.
          intents.value = intents.value.filter((candidate) => candidate.id !== intent.id);
        }
        await options.onResult(execution.result, appliedIntent);
        notifyFlushWaiters();
        if (hasDecreaseRemainder) continue;
      }
    } finally {
      activeLanes.delete(productId);
    }
  }

  function enqueue(intent: TableOrderMutationIntent) {
    if (options.disabled() || !intent.tableId) return false;
    const uncertain = intents.value.find((candidate) =>
      candidate.productId === intent.productId && candidate.status === 'UNCERTAIN',
    );
    if (uncertain) {
      retryIntent(uncertain.id);
      return false;
    }
    const previous = [...intents.value].reverse().find((candidate) => candidate.productId === intent.productId);
    if (
      previous?.status === 'QUEUED'
      && previous.mergeKey === intent.mergeKey
      && previous.kind !== intent.kind
    ) {
      previous.quantity -= intent.quantity;
      if (previous.quantity <= 0) removeIntent(previous.id);
      else {
        if (previous.kind === 'ADD') previous.payload.items[0]!.quantity = previous.quantity;
        touchIntents();
      }
      return true;
    }
    if (atCapacity(intent.productId)) {
      options.onBackpressure?.(intent.productId);
      return false;
    }
    if (
      previous?.status === 'QUEUED'
      && previous.kind === intent.kind
      && previous.mergeKey === intent.mergeKey
    ) {
      previous.quantity += intent.quantity;
      if (previous.kind === 'ADD') previous.payload.items[0]!.quantity = previous.quantity;
      touchIntents();
      return true;
    }
    intents.value.push(intent);
    touchIntents();
    void drainLane(intent.productId);
    return true;
  }

  function addProduct(
    productId: string,
    lineId = `product:${productId}`,
    sourceItemId?: string,
    mergeKey = productDirectMergeKey(productId),
    remark?: string,
  ) {
    const product = orderableProductById.value.get(productId);
    if (!product) return false;
    const idempotencyKey = createMutationKey('add');
    const firstAddedSequence = nextSequence++;
    return enqueue({
      id: idempotencyKey,
      kind: 'ADD',
      status: 'QUEUED',
      quantity: 1,
      tableId: options.tableId(),
      productId,
      product,
      lineId,
      mergeKey,
      firstAddedAt: new Date().toISOString(),
      firstAddedSequence,
      ...(sourceItemId ? { sourceItemId } : {}),
      ...(remark ? { remark } : {}),
      payload: {
        idempotencyKey,
        items: [{ productId, quantity: 1, ...(remark ? { remark } : {}) }],
      },
    });
  }

  function decreaseProduct(productId: string, mergeKey: string) {
    const requestKey = createMutationKey('decrease');
    return enqueue({
      id: requestKey,
      kind: 'DECREASE',
      status: 'QUEUED',
      quantity: 1,
      tableId: options.tableId(),
      productId,
      mergeKey,
      requestKey,
    });
  }

  function retryIntent(intentId: string) {
    const intent = intents.value.find((candidate) => candidate.id === intentId);
    if (!intent || intent.status !== 'UNCERTAIN') return false;
    intent.status = 'QUEUED';
    touchIntents();
    void drainLane(intent.productId);
    return true;
  }

  function retryProduct(productId: string) {
    const intent = intents.value.find((candidate) =>
      candidate.productId === productId && candidate.status === 'UNCERTAIN',
    );
    return intent ? retryIntent(intent.id) : false;
  }

  function canAddProduct(productId: string) {
    return !options.disabled()
      && orderableProductById.value.has(productId)
      && !atCapacity(productId);
  }

  function flush() {
    const state = settledState();
    if (state != null) return Promise.resolve(state);
    const productIds = new Set(intents.value
      .filter((intent) => intent.status === 'QUEUED')
      .map((intent) => intent.productId));
    productIds.forEach((productId) => void drainLane(productId));
    return new Promise<boolean>((resolve) => flushWaiters.add(resolve));
  }

  return {
    intents,
    mutationPending,
    mutationLocked,
    draftLines,
    pendingAddQuantities,
    pendingDecreaseMergeKeys,
    pendingDecreaseQuantities,
    uncertainDecreaseMergeKeys,
    uncertainDecreaseIntent,
    addProduct,
    decreaseProduct,
    retryIntent,
    retryProduct,
    canAddProduct,
    atCapacity,
    flush,
  };
}
