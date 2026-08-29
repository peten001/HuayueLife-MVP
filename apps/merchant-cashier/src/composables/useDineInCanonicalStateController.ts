import { computed, nextTick, ref } from 'vue';
import {
  CashierApiError,
  getDineInCanonicalState,
  isMutationOutcomeUncertain,
  reconcileDineInCanonicalState,
} from '@/api';
import { createMutationKey } from '@/domain';
import type {
  CashierMenuProduct,
  DineInCanonicalLine,
  DineInCanonicalState,
  ReconcileDineInCanonicalStateInput,
} from '@/types';

type DesiredOverride = {
  lineKey?: string;
  productId?: string;
  remark: string;
  desiredQuantity: number;
};

type FrozenBatch = {
  input: ReconcileDineInCanonicalStateInput;
  baseState: DineInCanonicalState;
  overrides: DesiredOverride[];
};

export const CANONICAL_BATCH_WINDOW_MS = 180;

export function useDineInCanonicalStateController(options: {
  sessionId: () => string;
  disabled: () => boolean;
  products: () => CashierMenuProduct[];
  onCommitted?: (state: DineInCanonicalState) => void | Promise<void>;
  onFailure?: (error: unknown) => void | Promise<void>;
  confirmSameLineConflict?: () => boolean | Promise<boolean>;
}) {
  const canonicalState = ref<DineInCanonicalState | null>(null);
  const desiredOverrides = ref(new Map<string, DesiredOverride>());
  const loading = ref(false);
  const syncing = ref(false);
  const conflict = ref(false);
  const uncertainBatch = ref<FrozenBatch | null>(null);
  let scheduled = false;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: FrozenBatch | null = null;
  let loadSequence = 0;
  let stateEpoch = 0;

  const presentedState = computed<DineInCanonicalState | null>(() => {
    const state = canonicalState.value;
    if (!state) return null;
    const lines = state.items.map((line) => {
      const override = desiredOverrides.value.get(`line:${line.lineKey}`);
      const quantity = override?.desiredQuantity ?? line.quantity;
      return {
        ...line,
        quantity,
        adjustableQuantity: Math.max(0, quantity - line.lockedQuantity),
        subtotalVnd: (BigInt(line.unitPriceVnd) * BigInt(quantity)).toString(),
      };
    }).filter((line) => line.quantity > 0);
    for (const override of desiredOverrides.value.values()) {
      if (!override.productId || override.desiredQuantity <= 0) continue;
      const product = options.products().find((candidate) => candidate.id === override.productId);
      if (!product) continue;
      lines.push({
        lineKey: `local:${override.productId}:${encodeURIComponent(override.remark)}`,
        productId: override.productId,
        productNameZh: product.nameZh,
        productNameVi: product.nameVi,
        productNameEn: product.nameEn,
        remark: override.remark,
        optionSignature: '',
        activeSince: new Date().toISOString(),
        displayOrderKey: `local:${Date.now()}:${override.productId}`,
        unitPriceVnd: product.priceVnd,
        quantity: override.desiredQuantity,
        lockedQuantity: 0,
        adjustableQuantity: override.desiredQuantity,
        subtotalVnd: (BigInt(product.priceVnd) * BigInt(override.desiredQuantity)).toString(),
        adjustability: 'RETURN',
        sourceSummary: { staffQuantity: override.desiredQuantity, qrQuantity: 0 },
      });
    }
    const originalAmountVnd = lines.reduce((sum, line) => sum + BigInt(line.subtotalVnd), 0n).toString();
    const dirty = desiredOverrides.value.size > 0;
    return {
      ...state,
      items: lines,
      totals: dirty
        ? {
            originalAmountVnd,
            discountPayableRateBps: null,
            discountAmountVnd: '0',
            roundingAmountVnd: '0',
            payableAmountVnd: originalAmountVnd,
          }
        : state.totals,
    };
  });

  const productQuantities = computed<Record<string, number>>(() => {
    const quantities: Record<string, number> = {};
    for (const line of presentedState.value?.items ?? []) {
      if (line.productId) quantities[line.productId] = (quantities[line.productId] ?? 0) + line.quantity;
    }
    return quantities;
  });
  const mutationLocked = computed(() => Boolean(uncertainBatch.value) || conflict.value);
  const mutationPending = computed(() => syncing.value || desiredOverrides.value.size > 0);

  async function load(force = false) {
    const sessionId = options.sessionId();
    if (!sessionId) {
      reset();
      return null;
    }
    const sequence = ++loadSequence;
    const epoch = stateEpoch;
    if (!canonicalState.value || force) loading.value = true;
    try {
      const state = await getDineInCanonicalState(sessionId);
      if (sequence !== loadSequence || epoch !== stateEpoch || sessionId !== options.sessionId()) return state;
      if (!inFlight && desiredOverrides.value.size === 0 && !uncertainBatch.value) {
        canonicalState.value = state;
      } else if (canonicalState.value?.revision === state.revision) {
        canonicalState.value = state;
      }
      return state;
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }

  function addProduct(productId: string, remark = '') {
    if (options.disabled() || mutationLocked.value) return;
    const state = presentedState.value;
    const product = options.products().find((candidate) => candidate.id === productId);
    if (!state || !product) return;
    const normalizedRemark = normalizeRemark(remark);
    const existing = state.items.find((line) =>
      !line.lineKey.startsWith('local:')
      && line.productId === productId
      && line.remark === normalizedRemark
      && line.unitPriceVnd === product.priceVnd,
    );
    if (existing) setLineQuantity(existing.lineKey, existing.quantity + 1);
    else {
      const key = newProductKey(productId, normalizedRemark);
      const current = desiredOverrides.value.get(key)?.desiredQuantity ?? 0;
      setOverride(key, { productId, remark: normalizedRemark, desiredQuantity: current + 1 });
    }
  }

  function increaseLine(line: DineInCanonicalLine) {
    if (options.disabled() || mutationLocked.value || !line.productId) return;
    if (line.lineKey.startsWith('local:')) addProduct(line.productId, line.remark);
    else setLineQuantity(line.lineKey, line.quantity + 1);
  }

  function decreaseLine(line: DineInCanonicalLine) {
    if (options.disabled() || mutationLocked.value || line.quantity <= line.lockedQuantity) return;
    if (line.lineKey.startsWith('local:') && line.productId) {
      const key = newProductKey(line.productId, line.remark);
      setOverride(key, {
        productId: line.productId,
        remark: line.remark,
        desiredQuantity: Math.max(0, line.quantity - 1),
      });
    } else setLineQuantity(line.lineKey, line.quantity - 1);
  }

  function setLineQuantity(lineKey: string, desiredQuantity: number) {
    const base = canonicalState.value?.items.find((line) => line.lineKey === lineKey);
    if (!base) return;
    const quantity = Math.max(base.lockedQuantity, Math.min(999, desiredQuantity));
    const key = `line:${lineKey}`;
    if (quantity === base.quantity) {
      const next = new Map(desiredOverrides.value);
      next.delete(key);
      desiredOverrides.value = next;
      scheduleSync();
      return;
    }
    setOverride(key, { lineKey, remark: base.remark, desiredQuantity: quantity });
  }

  function setOverride(key: string, override: DesiredOverride) {
    const next = new Map(desiredOverrides.value);
    if (override.desiredQuantity <= 0 && override.productId) next.delete(key);
    else next.set(key, override);
    desiredOverrides.value = next;
    scheduleSync();
  }

  function scheduleSync() {
    if (scheduled || inFlight || mutationLocked.value || options.disabled()) return;
    scheduled = true;
    scheduledTimer = setTimeout(() => {
      scheduled = false;
      scheduledTimer = null;
      void syncNextBatch();
    }, CANONICAL_BATCH_WINDOW_MS);
  }

  async function syncNextBatch() {
    const state = canonicalState.value;
    if (!state || inFlight || desiredOverrides.value.size === 0 || mutationLocked.value || options.disabled()) return;
    const overrides = [...desiredOverrides.value.values()].map((entry) => ({ ...entry }));
    const desiredByLine = new Map(
      overrides.filter((entry) => entry.lineKey).map((entry) => [entry.lineKey!, entry.desiredQuantity]),
    );
    const input: ReconcileDineInCanonicalStateInput = {
      requestKey: createMutationKey('canonical'),
      baseRevision: state.revision,
      desiredItems: [
        ...state.items.map((line) => ({
          lineKey: line.lineKey,
          desiredQuantity: desiredByLine.get(line.lineKey) ?? line.quantity,
        })),
        ...overrides.filter((entry) => entry.productId).map((entry) => ({
          productId: entry.productId,
          remark: entry.remark || undefined,
          desiredQuantity: entry.desiredQuantity,
        })),
      ],
    };
    const batch = { input, baseState: state, overrides };
    inFlight = batch;
    syncing.value = true;
    try {
      const next = await reconcileDineInCanonicalState(options.sessionId(), input);
      applyCommittedBatch(batch, next);
      await options.onCommitted?.(next);
    } catch (error) {
      if (isCanonicalRevisionConflict(error)) {
        await handleRevisionConflict(batch, error);
      } else if (isMutationOutcomeUncertain(error)) {
        uncertainBatch.value = batch;
        await options.onFailure?.(error);
      } else {
        desiredOverrides.value = new Map();
        await options.onFailure?.(error);
        await load(true).catch(() => undefined);
      }
    } finally {
      if (inFlight === batch) inFlight = null;
      syncing.value = false;
      await nextTick();
      if (!mutationLocked.value && desiredOverrides.value.size > 0) scheduleSync();
    }
  }

  function applyCommittedBatch(batch: FrozenBatch, next: DineInCanonicalState) {
    stateEpoch += 1;
    canonicalState.value = next;
    const remaining = new Map(desiredOverrides.value);
    for (const sent of batch.overrides) {
      if (sent.lineKey) {
        const key = `line:${sent.lineKey}`;
        if (remaining.get(key)?.desiredQuantity === sent.desiredQuantity) remaining.delete(key);
        continue;
      }
      if (!sent.productId) continue;
      const key = newProductKey(sent.productId, sent.remark);
      const current = remaining.get(key);
      const committedLine = findProductLine(next, sent.productId, sent.remark);
      if (!current || current.desiredQuantity === sent.desiredQuantity) {
        remaining.delete(key);
      } else if (committedLine) {
        remaining.delete(key);
        remaining.set(`line:${committedLine.lineKey}`, {
          lineKey: committedLine.lineKey,
          remark: committedLine.remark,
          desiredQuantity: current.desiredQuantity,
        });
      }
    }
    desiredOverrides.value = remaining;
  }

  async function handleRevisionConflict(batch: FrozenBatch, error: CashierApiError) {
    const latest = latestStateFromError(error);
    if (!latest) {
      conflict.value = true;
      await options.onFailure?.(error);
      return;
    }
    const overlaps = batch.overrides.some((override) => {
      if (override.lineKey) {
        const before = batch.baseState.items.find((line) => line.lineKey === override.lineKey);
        const current = latest.items.find((line) => line.lineKey === override.lineKey);
        return !before || !current || before.quantity !== current.quantity;
      }
      return Boolean(override.productId && findProductLine(latest, override.productId, override.remark));
    });
    let keepLocal = true;
    if (overlaps) keepLocal = await options.confirmSameLineConflict?.() ?? false;
    stateEpoch += 1;
    canonicalState.value = latest;
    conflict.value = false;
    if (!keepLocal) {
      desiredOverrides.value = new Map();
      return;
    }
    const rebased = new Map<string, DesiredOverride>();
    for (const override of batch.overrides) {
      if (override.lineKey) {
        const before = batch.baseState.items.find((line) => line.lineKey === override.lineKey);
        const current = latest.items.find((line) => line.lineKey === override.lineKey);
        if (!before || !current) continue;
        const desiredQuantity = Math.max(
          current.lockedQuantity,
          current.quantity + (override.desiredQuantity - before.quantity),
        );
        if (desiredQuantity !== current.quantity) {
          rebased.set(`line:${current.lineKey}`, {
            lineKey: current.lineKey,
            remark: current.remark,
            desiredQuantity,
          });
        }
      } else if (override.productId) {
        const current = findProductLine(latest, override.productId, override.remark);
        if (current) {
          rebased.set(`line:${current.lineKey}`, {
            lineKey: current.lineKey,
            remark: current.remark,
            desiredQuantity: current.quantity + override.desiredQuantity,
          });
        } else {
          rebased.set(newProductKey(override.productId, override.remark), override);
        }
      }
    }
    desiredOverrides.value = rebased;
  }

  async function retryUncertain() {
    const batch = uncertainBatch.value;
    if (!batch || inFlight || options.disabled()) return false;
    uncertainBatch.value = null;
    inFlight = batch;
    syncing.value = true;
    try {
      const next = await reconcileDineInCanonicalState(options.sessionId(), batch.input);
      applyCommittedBatch(batch, next);
      await options.onCommitted?.(next);
      return true;
    } catch (error) {
      if (isMutationOutcomeUncertain(error)) uncertainBatch.value = batch;
      else await options.onFailure?.(error);
      return false;
    } finally {
      if (inFlight === batch) inFlight = null;
      syncing.value = false;
      if (!mutationLocked.value && desiredOverrides.value.size > 0) scheduleSync();
    }
  }

  async function flush() {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
      scheduled = false;
      await syncNextBatch();
    }
    while ((inFlight || desiredOverrides.value.size > 0) && !mutationLocked.value) {
      if (!inFlight) await syncNextBatch();
      else await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
    return !mutationLocked.value && desiredOverrides.value.size === 0;
  }

  function acceptLatestAfterConflict() {
    conflict.value = false;
    desiredOverrides.value = new Map();
  }

  function adoptCommittedState(state: DineInCanonicalState) {
    stateEpoch += 1;
    loadSequence += 1;
    canonicalState.value = state;
    desiredOverrides.value = new Map();
    uncertainBatch.value = null;
    conflict.value = false;
  }

  function reset() {
    stateEpoch += 1;
    loadSequence += 1;
    canonicalState.value = null;
    desiredOverrides.value = new Map();
    uncertainBatch.value = null;
    conflict.value = false;
    syncing.value = false;
    scheduled = false;
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = null;
    inFlight = null;
  }

  return {
    canonicalState,
    presentedState,
    productQuantities,
    loading,
    syncing,
    mutationPending,
    mutationLocked,
    conflict,
    uncertainBatch,
    load,
    addProduct,
    increaseLine,
    decreaseLine,
    retryUncertain,
    flush,
    acceptLatestAfterConflict,
    adoptCommittedState,
    reset,
  };
}

function newProductKey(productId: string, remark: string) {
  return `product:${productId}\u0000${remark}`;
}

function normalizeRemark(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function findProductLine(state: DineInCanonicalState, productId: string, remark: string) {
  return state.items.find((line) => line.productId === productId && line.remark === remark);
}

function isCanonicalRevisionConflict(error: unknown): error is CashierApiError {
  return error instanceof CashierApiError && error.code === 'CANONICAL_REVISION_CONFLICT';
}

function latestStateFromError(error: CashierApiError) {
  if (!error.details || typeof error.details !== 'object') return null;
  const latest = (error.details as { latestState?: unknown }).latestState;
  return latest && typeof latest === 'object' && 'revision' in latest
    ? latest as DineInCanonicalState
    : null;
}
