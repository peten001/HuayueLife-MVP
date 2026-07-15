<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  cancelPrintingJob,
  getPrintingJob,
  getPrintingJobs,
  retryPrintingJob,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintJobSource,
  PrintJobStatus,
  PrintingJob,
} from '@/types/printing';

const { p } = usePrintingI18n();
const rows = ref<PrintingJob[]>([]);
const selected = ref<PrintingJob | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const message = ref('');
const success = ref(false);
const filters = reactive({ status: '' as PrintJobStatus | '', source: '' as PrintJobSource | '' });

const statuses: PrintJobStatus[] = [
  'PENDING',
  'CLAIMED',
  'PRINTING',
  'SUCCEEDED',
  'RETRY_WAIT',
  'FAILED',
  'CANCELLED',
];
const sources: PrintJobSource[] = ['AUTOMATIC', 'MANUAL_REPRINT', 'TEST'];

async function load() {
  try {
    loading.value = true;
    rows.value = await getPrintingJobs(filters);
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function openDetail(row: PrintingJob) {
  try {
    detailLoading.value = true;
    selected.value = await getPrintingJob(row.id);
  } catch (error) {
    showError(error);
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  selected.value = null;
}

async function cancelJob(row: PrintingJob) {
  if (!window.confirm(p('cancelJobConfirm'))) return;
  try {
    await cancelPrintingJob(row.id);
    selected.value = null;
    await load();
    showSuccess(p('jobCancelled'));
  } catch (error) {
    showError(error);
  }
}

async function retryJob(row: PrintingJob) {
  if (!window.confirm(p('retryJobConfirm'))) return;
  try {
    await retryPrintingJob(row.id);
    selected.value = null;
    await load();
    showSuccess(p('jobRetried'));
  } catch (error) {
    showError(error);
  }
}

function canCancel(row: PrintingJob) {
  return row.status === 'PENDING' || row.status === 'RETRY_WAIT';
}

function canRetry(row: PrintingJob) {
  return (
    row.status === 'FAILED' &&
    !row.retryBlocked &&
    row.lastErrorCode !== 'PRINT_OUTCOME_UNKNOWN' &&
    row.attemptCount < row.maxAttempts
  );
}

function statusClass(status: PrintJobStatus) {
  if (status === 'SUCCEEDED') return 'printing-badge--success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'printing-badge--danger';
  if (status === 'PRINTING' || status === 'CLAIMED') return 'printing-badge--info';
  return 'printing-badge--warning';
}

function orderReference(row: PrintingJob) {
  if (row.order?.orderNo) return row.order.orderNo;
  const snapshot = row.receiptSnapshot ?? {};
  const order = snapshot.order;
  const orderNo =
    order && typeof order === 'object' && !Array.isArray(order)
      ? (order as Record<string, unknown>).orderNo
      : undefined;
  if (typeof orderNo === 'string' && orderNo) return orderNo;
  return row.orderId || '—';
}

function showError(error: unknown) {
  success.value = false;
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  success.value = true;
  message.value = value;
}

onMounted(load);
</script>

<template>
  <section class="printing-panel">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('jobs') }}</h2>
        <p>{{ p('webCannotSucceed') }}</p>
      </div>
      <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
    </div>

    <div class="printing-filters">
      <label class="printing-field">
        {{ p('filterStatus') }}
        <select v-model="filters.status" class="printing-filter" @change="load">
          <option value="">{{ p('all') }}</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="printing-field">
        {{ p('filterSource') }}
        <select v-model="filters.source" class="printing-filter" @change="load">
          <option value="">{{ p('all') }}</option>
          <option v-for="source in sources" :key="source" :value="source">{{ source }}</option>
        </select>
      </label>
    </div>

    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('status') }}</th>
            <th>{{ p('orderId') }}</th>
            <th>{{ p('printer') }}</th>
            <th>{{ p('receiptType') }}</th>
            <th>{{ p('source') }}</th>
            <th>{{ p('attempts') }}</th>
            <th>{{ p('createdAt') }}</th>
            <th>{{ p('lastError') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <span :class="['printing-badge', statusClass(row.status)]">{{ row.status }}</span>
              <small v-if="row.retryBlocked" class="printing-text-danger">{{ p('outcomeUnknown') }}</small>
            </td>
            <td><strong>{{ orderReference(row) }}</strong><small><code>{{ row.id }}</code></small></td>
            <td>{{ row.printer?.name || row.printerId }}</td>
            <td>{{ row.receiptType }}</td>
            <td>{{ row.source }}</td>
            <td>{{ row.attemptCount }} / {{ row.maxAttempts }}</td>
            <td>{{ new Date(row.createdAt).toLocaleString() }}</td>
            <td>{{ row.lastErrorCode || '—' }}<small v-if="row.lastErrorMessage">{{ row.lastErrorMessage }}</small></td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openDetail(row)">{{ p('view') }}</button>
                <button v-if="canCancel(row)" class="printing-button printing-button--danger printing-button--small" type="button" @click="cancelJob(row)">{{ p('cancelJob') }}</button>
                <button v-if="canRetry(row)" class="printing-button printing-button--secondary printing-button--small" type="button" @click="retryJob(row)">{{ p('retry') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="9">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="9">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="selected || detailLoading" class="printing-modal-backdrop" @click.self="closeDetail">
    <section class="printing-modal printing-modal--wide">
      <header class="printing-modal__header"><h2>{{ p('detail') }}</h2></header>
      <div class="printing-modal__body">
        <p v-if="detailLoading" class="printing-hint printing-field--full">{{ p('loading') }}</p>
        <template v-if="selected">
          <dl class="printing-detail-grid printing-field--full">
            <dt>{{ p('jobId') }}</dt><dd>{{ selected.id }}</dd>
            <dt>{{ p('status') }}</dt><dd>{{ selected.status }}</dd>
            <dt>{{ p('orderId') }}</dt><dd>{{ selected.orderId || '—' }}</dd>
            <dt>{{ p('printer') }}</dt><dd>{{ selected.printer?.name || selected.printerId }}</dd>
            <dt>{{ p('source') }}</dt><dd>{{ selected.source }}</dd>
            <dt>{{ p('triggerEvent') }}</dt><dd>{{ selected.triggerEvent }}</dd>
            <dt>{{ p('attempts') }}</dt><dd>{{ selected.attemptCount }} / {{ selected.maxAttempts }}</dd>
            <dt>{{ p('lastError') }}</dt><dd>{{ selected.lastErrorCode || '—' }} {{ selected.lastErrorMessage || '' }}</dd>
            <dt v-if="selected.retryBlocked">{{ p('status') }}</dt><dd v-if="selected.retryBlocked" class="printing-text-danger">{{ p('outcomeUnknownHint') }}</dd>
          </dl>
          <label class="printing-field printing-field--full">
            {{ p('snapshot') }}
            <pre class="printing-json">{{ JSON.stringify(selected.receiptSnapshot ?? {}, null, 2) }}</pre>
          </label>
        </template>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeDetail">{{ p('close') }}</button>
        <button v-if="selected && canCancel(selected)" class="printing-button printing-button--danger" type="button" @click="cancelJob(selected)">{{ p('cancelJob') }}</button>
        <button v-if="selected && canRetry(selected)" class="printing-button" type="button" @click="retryJob(selected)">{{ p('retry') }}</button>
      </footer>
    </section>
  </div>
</template>
