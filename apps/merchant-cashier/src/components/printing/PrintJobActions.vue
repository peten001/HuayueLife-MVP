<script setup lang="ts">
import { CircleCheck, LoaderCircle, Printer, RefreshCw, RotateCcw, TriangleAlert, WifiOff } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { apiErrorTranslationKey, isMutationOutcomeUncertain } from '@/api';
import { useI18n } from '@/i18n';
import { useNetworkStore, usePrintingStore, useUiStore } from '@/stores';
import type { CashierPrintJob } from '@/types';

const props = defineProps<{
  orderId?: string;
  tableSessionId?: string;
  disabled?: boolean;
  compact?: boolean;
  compactMode?: 'standard' | 'inline';
}>();

const { t } = useI18n();
const printingStore = usePrintingStore();
const networkStore = useNetworkStore();
const uiStore = useUiStore();
const { readyUsbPrinters, availability, submitting } = storeToRefs(printingStore);
const { online, apiReachable } = storeToRefs(networkStore);
const selectedPrinterId = ref('');
const jobs = ref<CashierPrintJob[]>([]);
const jobsLoading = ref(false);
const submitPending = ref(false);
const reprintOpen = ref(false);
const reprintReason = ref('');
const activeJobId = ref('');
const localFeedback = ref<'IDLE' | 'ERROR' | 'UNKNOWN'>('IDLE');
let refreshTimer: number | undefined;
let successFeedbackTimer: number | undefined;

const latestJob = computed(() => jobs.value[0] ?? null);
const activeJob = computed(() => jobs.value.find((job) => job.id === activeJobId.value) ?? null);
const hasInFlightJob = computed(() => jobs.value.some((job) =>
  job.status === 'PENDING'
  || job.status === 'CLAIMED'
  || job.status === 'PRINTING'
  || job.status === 'RETRY_WAIT',
));
const inFlightJob = computed(() => jobs.value.find((job) =>
  job.status === 'PENDING'
  || job.status === 'CLAIMED'
  || job.status === 'PRINTING'
  || job.status === 'RETRY_WAIT',
) ?? null);
const entityKey = computed(() => props.tableSessionId || props.orderId || '');
const networkReady = computed(() => online.value && apiReachable.value === true);
const canSubmit = computed(
  () => printingStore.ready && networkReady.value && !props.disabled &&
    !submitting.value && !submitPending.value && !hasInFlightJob.value,
);
const statusLabel = computed(() => {
  if (availability.value === 'READY') return t('print.ready');
  if (availability.value === 'NOT_CONFIGURED') return t('print.configurationRequired');
  if (availability.value === 'DEVICE_OFFLINE') return t('print.terminalOffline');
  if (availability.value === 'LOADING') return t('print.checking');
  return t('print.disabled');
});
const latestStatusLabel = computed(() =>
  latestJob.value ? t('print.jobStatus', { status: latestJob.value.status }) : '',
);
const compactVisualState = computed(() => {
  if (submitPending.value || submitting.value) {
    return compactState('submitting', 'busy', t('print.submitting'), t('print.submitting'), true, true);
  }

  const currentJob = activeJob.value || inFlightJob.value;
  if (currentJob?.status === 'SUCCEEDED') {
    return compactState('success', 'success', t('print.succeeded'), t('print.succeeded'), true);
  }
  if (currentJob?.status === 'FAILED' && currentJob.lastErrorCode === 'PRINT_OUTCOME_UNKNOWN') {
    return compactState('unknown', 'warning', t('print.outcomeUnknown'), t('print.outcomeUnknownLockedHint'), true);
  }
  if (currentJob?.status === 'FAILED' || currentJob?.status === 'CANCELLED') {
    return compactState('error', 'error', t('print.retryAction'), t('print.retryHint'), !canSubmit.value);
  }

  if (localFeedback.value === 'UNKNOWN') {
    return compactState('unknown', 'warning', t('print.outcomeUnknown'), t('print.outcomeUnknownHint'), !canSubmit.value);
  }
  if (localFeedback.value === 'ERROR') {
    return compactState('error', 'error', t('print.retryAction'), t('print.retryHint'), !canSubmit.value);
  }

  if (!online.value || apiReachable.value === false) {
    return compactState('network-offline', 'muted', t('print.networkUnavailableShort'), t('print.networkUnavailable'), true);
  }
  if (apiReachable.value === null || availability.value === 'LOADING') {
    return compactState('checking', 'muted', t('print.checkingShort'), t('print.checking'), true, true);
  }
  if (availability.value === 'DEVICE_OFFLINE') {
    return compactState('offline', 'muted', t('print.terminalOfflineShort'), t('print.terminalOffline'), true);
  }
  if (availability.value === 'NOT_CONFIGURED') {
    return compactState('not-configured', 'muted', t('print.configurationRequiredShort'), t('print.configurationRequired'), true);
  }
  if (availability.value === 'NOT_ENABLED') {
    return compactState('not-enabled', 'muted', t('print.disabledShort'), t('print.disabled'), true);
  }
  if (props.disabled) {
    return compactState('blocked', 'muted', t('print.action'), t('print.blocked'), true);
  }
  if (currentJob?.status === 'PENDING' || currentJob?.status === 'CLAIMED' || currentJob?.status === 'PRINTING') {
    return compactState('printing', 'busy', t('print.inProgress'), t('print.inProgress'), true, true);
  }
  if (currentJob?.status === 'RETRY_WAIT') {
    return compactState('retrying', 'warning', t('print.retrying'), t('print.retrying'), true, true);
  }
  return compactState('ready', 'ready', t('print.action'), t('print.ready'), !canSubmit.value);
});

function compactState(
  state: string,
  tone: 'ready' | 'muted' | 'busy' | 'warning' | 'success' | 'error',
  label: string,
  title: string,
  disabled: boolean,
  busy = false,
) {
  return { state, tone, label, title, disabled, busy } as const;
}

watch(
  readyUsbPrinters,
  (available) => {
    if (!available.some((printer) => printer.id === selectedPrinterId.value)) {
      selectedPrinterId.value = available[0]?.id || '';
    }
  },
  { immediate: true },
);

watch(entityKey, () => void refreshJobs(), { immediate: true });
watch(activeJob, (job) => {
  if (successFeedbackTimer !== undefined) window.clearTimeout(successFeedbackTimer);
  successFeedbackTimer = undefined;
  if (job?.status !== 'SUCCEEDED') return;
  successFeedbackTimer = window.setTimeout(() => {
    if (activeJobId.value === job.id) activeJobId.value = '';
    successFeedbackTimer = undefined;
  }, 2_500);
});

async function refreshJobs() {
  if (!entityKey.value || availability.value !== 'READY') {
    jobs.value = [];
    return;
  }
  jobsLoading.value = true;
  try {
    jobs.value = await printingStore.listEntityJobs({
      ...(props.tableSessionId ? { tableSessionId: props.tableSessionId } : {}),
      ...(!props.tableSessionId && props.orderId ? { orderId: props.orderId } : {}),
    });
  } catch {
    // The top-level availability remains visible; avoid obscuring order details.
  } finally {
    jobsLoading.value = false;
  }
}

async function print() {
  if (!canSubmit.value || !selectedPrinterId.value || submitPending.value) return;
  if (successFeedbackTimer !== undefined) window.clearTimeout(successFeedbackTimer);
  successFeedbackTimer = undefined;
  activeJobId.value = '';
  localFeedback.value = 'IDLE';
  submitPending.value = true;
  try {
    const job = props.tableSessionId
      ? await printingStore.printTableBill(props.tableSessionId, selectedPrinterId.value)
      : props.orderId
        ? await printingStore.printOrder(props.orderId, selectedPrinterId.value)
        : null;
    if (!job) return;
    activeJobId.value = job.id;
    jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)];
  } catch (caught) {
    const uncertain = isMutationOutcomeUncertain(caught);
    localFeedback.value = uncertain ? 'UNKNOWN' : 'ERROR';
    uiStore.pushToast(
      t(uncertain ? 'print.outcomeUnknownHint' : apiErrorTranslationKey(caught, 'print.createFailed')),
      uncertain ? 'warning' : 'error',
    );
  } finally {
    submitPending.value = false;
  }
}

async function reprint() {
  if (!canSubmit.value || !latestJob.value || reprintReason.value.trim().length < 3) return;
  try {
    const job = await printingStore.reprint(
      latestJob.value.id,
      reprintReason.value,
      selectedPrinterId.value,
    );
    jobs.value = [job, ...jobs.value];
    reprintReason.value = '';
    reprintOpen.value = false;
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'print.createFailed')), 'error');
  }
}

onMounted(() => {
  refreshTimer = window.setInterval(() => void refreshJobs(), 5_000);
});

onBeforeUnmount(() => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  if (successFeedbackTimer !== undefined) window.clearTimeout(successFeedbackTimer);
});
</script>

<template>
  <button
    v-if="compact"
    type="button"
    :class="[
      'secondary-action',
      'detail-print-action',
      'dinein-action-button',
      compactMode === 'inline' ? 'detail-print-action--inline' : '',
      orderId ? 'order-print-action' : 'table-print-action',
      `detail-print-action--${compactVisualState.tone}`,
    ]"
    data-testid="print-primary"
    :data-print-state="compactVisualState.state"
    :data-print-tone="compactVisualState.tone"
    :title="compactVisualState.title"
    :aria-label="`${compactVisualState.label} · ${compactVisualState.title}`"
    :aria-busy="compactVisualState.busy"
    :disabled="compactVisualState.disabled || !selectedPrinterId"
    @click="print"
  >
    <LoaderCircle v-if="compactVisualState.busy" :size="18" class="detail-print-action__spinner" aria-hidden="true" />
    <CircleCheck v-else-if="compactVisualState.state === 'success'" :size="18" aria-hidden="true" />
    <WifiOff v-else-if="compactVisualState.state === 'offline' || compactVisualState.state === 'network-offline'" :size="18" aria-hidden="true" />
    <TriangleAlert v-else-if="compactVisualState.tone === 'error' || compactVisualState.tone === 'warning'" :size="18" aria-hidden="true" />
    <Printer v-else :size="18" aria-hidden="true" />
    <span class="detail-print-action__label" aria-live="polite">{{ compactVisualState.label }}</span>
  </button>

  <section v-else class="print-job-actions" :aria-label="t('print.sectionTitle')">
    <header>
      <span><Printer :size="18" aria-hidden="true" />{{ t('print.sectionTitle') }}</span>
      <button type="button" :title="t('common.refresh')" :disabled="jobsLoading" @click="refreshJobs">
        <RefreshCw :size="15" :class="{ spinning: jobsLoading }" aria-hidden="true" />
      </button>
    </header>

    <p
      :class="['print-job-actions__status', `print-job-actions__status--${availability.toLowerCase()}`]"
      data-testid="print-availability"
    >
      {{ statusLabel }}
    </p>

    <label v-if="readyUsbPrinters.length > 1">
      {{ t('print.printer') }}
      <select v-model="selectedPrinterId" :disabled="submitting">
        <option v-for="printer in readyUsbPrinters" :key="printer.id" :value="printer.id">
          {{ printer.name }} · {{ printer.paperWidth === 'MM58' ? '58mm' : '80mm' }}
        </option>
      </select>
    </label>

    <small v-if="latestJob" class="print-job-actions__latest">
      {{ latestStatusLabel }}<template v-if="latestJob.lastErrorCode"> · {{ latestJob.lastErrorCode }}</template>
    </small>

    <div class="print-job-actions__buttons">
      <button
        type="button"
        class="secondary-action"
        data-testid="print-primary"
        :disabled="!canSubmit || !selectedPrinterId"
        @click="print"
      >
        <Printer :size="18" aria-hidden="true" />
        {{ orderId ? t('print.order') : t('bill.printTableBill') }}
      </button>
      <button
        v-if="latestJob"
        type="button"
        class="secondary-action"
        :disabled="!canSubmit"
        @click="reprintOpen = !reprintOpen"
      >
        <RotateCcw :size="18" aria-hidden="true" />{{ t('print.reprint') }}
      </button>
    </div>

    <form v-if="reprintOpen" class="print-job-actions__reason" @submit.prevent="reprint">
      <label>
        {{ t('print.reprintReason') }}
        <input
          v-model="reprintReason"
          required
          minlength="3"
          maxlength="255"
          :placeholder="t('print.reprintReasonPlaceholder')"
        />
      </label>
      <div>
        <button type="button" class="secondary-action" @click="reprintOpen = false">{{ t('common.cancel') }}</button>
        <button
          type="submit"
          class="primary-action"
          :disabled="!canSubmit || reprintReason.trim().length < 3"
        >
          {{ t('common.confirm') }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
/* finesse · component: print action button · register=product
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * tokens: inherited (apps/merchant-cashier/src/styles/tokens.css) */
.detail-print-action {
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: border-color 140ms ease, color 140ms ease, background-color 140ms ease, transform 90ms ease;
}
.detail-print-action__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-print-action__spinner { animation: detail-print-action-spin 780ms linear infinite; }
.detail-print-action:focus-visible { outline-color: var(--cashier-blue); }
.detail-print-action:active:not(:disabled) { transform: translateY(1px); }
.detail-print-action:disabled { cursor: not-allowed; opacity: .5; }
@media (hover: hover) and (pointer: fine) {
  .detail-print-action--ready:hover:not(:disabled) { border-color: var(--cashier-blue); }
  .detail-print-action--error:hover:not(:disabled) { border-color: var(--cashier-red); }
  .detail-print-action--warning:hover:not(:disabled) { border-color: var(--cashier-yellow); }
}
@media (prefers-reduced-motion: reduce) {
  .detail-print-action { transition: none; }
  .detail-print-action__spinner { animation: none; }
}
@keyframes detail-print-action-spin { to { transform: rotate(360deg); } }
</style>
