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

const MAX_PENDING_INTENTS_PER_PRODUCT = 12;

type IntentStatus = 'QUEUED' | 'IN_FLIGHT' | 'UNCERTAIN';

interface BaseIntent {
  id: string;
  tableId: string;
  productId: string;
  mergeKey: string;
  status: IntentStatus;
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
}

export interface TableOrderMutationControllerOptions {
  tableId: () => string;
  sessionId: () => string;
  disabled: () => boolean;
  orderableProducts: () => CashierMenuProduct[];
  executeDecrease: (input: TableOrderDecreaseExecution) => Promise<MerchantOrderMutationResult>;
  onResult: (result: MerchantOrderMutationResult, intent: TableOrderMutationIntent | null) => void | Promise<void>;
  onFailure: (error: unknown, intent: TableOrderMutationIntent | null) => void | Promise<void>;
  onBackpressure?: (productId: string) => void;
}

/**
 * Stable page-level owner for table order writes. UI components only enqueue
 * immutable intents; idempotency, ordering, optimistic presentation and retry
 * all remain alive even while the menu workspace is unmounted.
 */
export function useTableOrderMutationController(options: TableOrderMutationControllerOptions) {
  const intents = ref<TableOrderMutationIntent[]>([]);
  const effectiveSessionId = ref(options.sessionId());
  const pendingOpenPayload = ref<CreateMerchantTableOrderInput | null>(null);
  const activeLanes = new Set<string>();
  let openingPromise: Promise<boolean> | null = null;
  let nextSequence = 0;

  const orderableProductById = computed(() => new Map(
    options.orderableProducts().map((product) => [product.id, product]),
  ));
  const mutationLocked = computed(() => Boolean(intents.value.length || pendingOpenPayload.value));
  const draftLines = computed<CashierOrderingDraftLine[]>(() => {
    const grouped = new Map<string, CashierOrderingDraftLine>();
    for (const intent of intents.value) {
      if (intent.kind !== 'ADD') continue;
      const current = grouped.get(intent.mergeKey);
      if (current) {
        current.quantity += 1;
        continue;
      }
      grouped.set(intent.mergeKey, {
        lineId: intent.lineId,
        mergeKey: intent.mergeKey,
        product: intent.product,
        quantity: 1,
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
      if (intent.kind === 'ADD') quantities[intent.productId] = (quantities[intent.productId] || 0) + 1;
    }
    return quantities;
  });
  const pendingDecreaseMergeKeys = computed(() => new Set(
    intents.value.filter((intent) => intent.kind === 'DECREASE').map((intent) => intent.mergeKey),
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
  }

  function productIntentCount(productId: string) {
    return intents.value.filter((intent) => intent.productId === productId).length;
  }

  function atCapacity(productId: string) {
    return productIntentCount(productId) >= MAX_PENDING_INTENTS_PER_PRODUCT;
  }

  function removeIntent(id: string) {
    intents.value = intents.value.filter((intent) => intent.id !== id);
  }

  function rollbackTableIntents(tableId: string) {
    intents.value = intents.value.filter((intent) => intent.tableId !== tableId);
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
        await options.onResult(result, null);
        resumeOpenIntents();
        return true;
      })
      .catch(async (error) => {
        if (error instanceof CashierApiError && error.code === 'TABLE_ALREADY_OPEN') {
          effectiveSessionId.value = 'OPEN_SESSION_CONFIRMED_BY_SERVER';
          pendingOpenPayload.value = null;
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
      return createMerchantTableOrder(intent.tableId, intent.payload);
    }
    return options.executeDecrease({
      tableId: intent.tableId,
      productId: intent.productId,
      mergeKey: intent.mergeKey,
      requestKey: intent.requestKey,
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
        try {
          if (!(await ensureTableSession(intent))) break;
          const result = await executeIntent(intent);
          effectiveSessionId.value = result.session.id;
          await options.onResult(result, intent);
          removeIntent(intent.id);
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
    if (atCapacity(intent.productId)) {
      options.onBackpressure?.(intent.productId);
      return false;
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

  return {
    intents,
    mutationLocked,
    draftLines,
    pendingAddQuantities,
    pendingDecreaseMergeKeys,
    uncertainDecreaseIntent,
    addProduct,
    decreaseProduct,
    retryIntent,
    retryProduct,
    canAddProduct,
    atCapacity,
  };
}
