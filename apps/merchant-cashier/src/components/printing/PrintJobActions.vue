<script setup lang="ts">
import { Printer, RefreshCw, RotateCcw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { apiErrorTranslationKey } from '@/api';
import { useI18n } from '@/i18n';
import { useNetworkStore, usePrintingStore, useUiStore } from '@/stores';
import type { CashierPrintJob } from '@/types';

const props = defineProps<{
  orderId?: string;
  tableSessionId?: string;
  disabled?: boolean;
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
const reprintOpen = ref(false);
const reprintReason = ref('');
let refreshTimer: number | undefined;

const latestJob = computed(() => jobs.value[0] ?? null);
const entityKey = computed(() => props.orderId || props.tableSessionId || '');
const networkReady = computed(() => online.value && apiReachable.value !== false);
const canSubmit = computed(
  () => printingStore.ready && networkReady.value && !props.disabled && !submitting.value,
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

async function refreshJobs() {
  if (!entityKey.value || availability.value !== 'READY') {
    jobs.value = [];
    return;
  }
  jobsLoading.value = true;
  try {
    jobs.value = await printingStore.listEntityJobs({
      ...(props.orderId ? { orderId: props.orderId } : {}),
      ...(props.tableSessionId ? { tableSessionId: props.tableSessionId } : {}),
    });
  } catch {
    // The top-level availability remains visible; avoid obscuring order details.
  } finally {
    jobsLoading.value = false;
  }
}

async function print() {
  if (!canSubmit.value || !selectedPrinterId.value) return;
  try {
    const job = props.orderId
      ? await printingStore.printOrder(props.orderId, selectedPrinterId.value)
      : props.tableSessionId
        ? await printingStore.printTableBill(props.tableSessionId, selectedPrinterId.value)
        : null;
    if (!job) return;
    jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)];
    uiStore.pushToast(t('print.jobCreated'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'print.createFailed')), 'error');
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
    uiStore.pushToast(t('print.reprintCreated'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'print.createFailed')), 'error');
  }
}

onMounted(() => {
  refreshTimer = window.setInterval(() => void refreshJobs(), 5_000);
});

onBeforeUnmount(() => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="print-job-actions" :aria-label="t('print.sectionTitle')">
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
