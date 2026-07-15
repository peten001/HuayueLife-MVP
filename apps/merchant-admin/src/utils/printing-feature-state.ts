import { getPrintingFeatureState } from '@/api/printing';
import type { PrintingFeatureState } from '@/types/printing';

const SAFE_DISABLED_STATE: Readonly<PrintingFeatureState> = Object.freeze({
  taskCenterEnabled: true,
  automaticCreationEnabled: false,
  executionEnabled: false,
  legacyPrintingEnabled: false,
  merchantPrintingEnabled: false,
  executionState: 'CONNECTOR_PENDING',
});

let cachedState: PrintingFeatureState | null = null;
let pendingRequest: Promise<PrintingFeatureState> | null = null;

/**
 * Resolves the authenticated server feature state without exposing server
 * configuration. A failed or malformed response always fails closed: the
 * preserved legacy UI remains hidden and cannot call the old print APIs.
 */
export async function resolvePrintingFeatureState(): Promise<PrintingFeatureState> {
  if (cachedState) return cachedState;
  if (pendingRequest) return pendingRequest;

  pendingRequest = getPrintingFeatureState()
    .then((state) => {
      const normalized = normalizeState(state);
      if (normalized !== SAFE_DISABLED_STATE) cachedState = normalized;
      return normalized;
    })
    .catch(() => SAFE_DISABLED_STATE)
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}

function normalizeState(value: PrintingFeatureState): PrintingFeatureState {
  if (
    typeof value?.taskCenterEnabled !== 'boolean'
    || typeof value?.automaticCreationEnabled !== 'boolean'
    || typeof value?.executionEnabled !== 'boolean'
    || typeof value?.legacyPrintingEnabled !== 'boolean'
    || typeof value?.merchantPrintingEnabled !== 'boolean'
    || !['CONNECTOR_PENDING', 'READY_FOR_CONNECTOR'].includes(value.executionState)
    || (value.legacyPrintingEnabled && value.automaticCreationEnabled)
  ) {
    return SAFE_DISABLED_STATE;
  }

  return {
    taskCenterEnabled: value.taskCenterEnabled,
    automaticCreationEnabled: value.automaticCreationEnabled,
    executionEnabled: value.executionEnabled,
    legacyPrintingEnabled: value.legacyPrintingEnabled,
    merchantPrintingEnabled: value.merchantPrintingEnabled,
    executionState: value.executionState,
  };
}
