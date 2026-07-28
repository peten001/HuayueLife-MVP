<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  cancelPrintingJob,
  getPrintingJob,
  getPrintingJobs,
  reprintPrintingJob,
  retryPrintingJob,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintJobSource,
  PrintJobStatus,
  PrintingJob,
} from '@/types/printing';
import {
  latestPrintingAttempt,
  printingJobCanReprint,
  printingJobCanRetry,
  printingJobDisplayState,
  type PrintingJobDisplayState,
} from '@/utils/printing-job-status';

const { p } = usePrintingI18n();
const rows = ref<PrintingJob[]>([]);
const selected = ref<PrintingJob | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const message = ref('');
const success = ref(false);
const actionLoading = ref(false);
const actionConfirmButton = ref<HTMLButtonElement | null>(null);
let actionReturnFocus: HTMLElement | null = null;
const pendingAction = ref<{
  type: 'cancel' | 'retry' | 'reprint';
  row: PrintingJob;
} | null>(null);
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
const sources: PrintJobSource[] = ['AUTOMATIC', 'MANUAL', 'MANUAL_REPRINT', 'TEST'];

function statusLabel(row: PrintingJob) {
  const labels: Record<PrintingJobDisplayState, string> = {
    WAITING_EXECUTION: p('waitingExecution'),
    CLAIMED: p('claimed'),
    PRINTING: p('printing'),
    SUBMITTING: p('cloudSubmitting'),
    SUBMITTED: p('cloudSubmitted'),
    ACCEPTED: p('cloudAccepted'),
    PRINTED: p('cloudPrinted'),
    FAILED: p('printFailed'),
    UNKNOWN: p('cloudResultUnknown'),
    NOT_CONFIGURED: p('cloudNotConfigured'),
    RETRY_WAIT: p('retryWaiting'),
    CANCELLED: p('cancelled'),
  };
  return labels[printingJobDisplayState(row)];
}

function sourceLabel(source: PrintJobSource) {
  const labels: Record<PrintJobSource, string> = {
    AUTOMATIC: p('automatic'), MANUAL: p('manual'), MANUAL_REPRINT: p('manualReprint'), TEST: p('testSource'),
  };
  return labels[source];
}

function receiptTypeLabel(type: string) {
  return type === 'TABLE_BILL' ? p('checkoutReceipt') : p('customerReceipt');
}

function errorLabel(code: string | null | undefined, messageText: string | null | undefined) {
  const labels: Record<string, string> = {
    PRINTER_NOT_CONNECTED: p('printerNotConnectedError'), PRINTER_OFFLINE: p('printerOfflineError'), USB_PERMISSION_REQUIRED: p('usbUnauthorizedError'),
    LAN_CONNECTION_FAILED: p('lanConnectionError'), CLOUD_PROVIDER_UNAVAILABLE: p('cloudUnavailableError'), DEVICE_INFO_INVALID: p('deviceInfoError'), PRINT_TIMEOUT: p('printTimeoutError'), PRINT_OUTCOME_UNKNOWN: p('cloudResultUnknownError'),
    CLOUD_PROVIDER_NOT_CONFIGURED: p('cloudNotConfiguredError'), CLOUD_CREDENTIALS_INVALID: p('cloudCredentialsError'), CLOUD_DEVICE_INVALID: p('cloudDeviceError'), CLOUD_PROVIDER_REJECTED: p('cloudRejectedError'), CLOUD_TASK_CANCELLED: p('cloudTaskCancelledError'), CLOUD_RESULT_PENDING: p('cloudSubmittedHint'),
  };
  if (code && labels[code]) return labels[code];
  return messageText || (code ? p('printErrorUnknown') : '—');
}

function recordHint(row: PrintingJob) {
  const attempt = latestPrintingAttempt(row);
  if (attempt?.cloudStatus === 'SUBMITTED' || attempt?.cloudStatus === 'ACCEPTED') {
    return p('cloudSubmittedHint');
  }
  if (attempt?.cloudStatus === 'UNKNOWN') return p('cloudResultUnknownError');
  if (attempt?.cloudStatus === 'NOT_CONFIGURED') return p('cloudNotConfiguredError');
  if (row.lastErrorCode || attempt?.errorCode) {
    return errorLabel(
      attempt?.errorCode || row.lastErrorCode,
      attempt?.errorMessage || row.lastErrorMessage,
    );
  }
  return '';
}

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
  try {
    await retryPrintingJob(row.id);
    selected.value = null;
    await load();
    showSuccess(p('jobRetried'));
  } catch (error) {
    showError(error);
  }
}

async function reprintJob(row: PrintingJob) {
  try {
    const job = await reprintPrintingJob(
      row.id,
      `admin.${crypto.randomUUID()}`,
      p('reprintReason'),
    );
    selected.value = null;
    await load();
    showSuccess(`${p('jobReprinted')} · #${job.id}`);
  } catch (error) {
    showError(error);
  }
}

function requestAction(type: 'cancel' | 'retry' | 'reprint', row: PrintingJob) {
  actionReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  pendingAction.value = { type, row };
  void nextTick(() => actionConfirmButton.value?.focus());
}

function closePendingAction() {
  pendingAction.value = null;
  const target = actionReturnFocus;
  actionReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function actionTitle() {
  if (pendingAction.value?.type === 'cancel') return p('cancelJob');
  if (pendingAction.value?.type === 'retry') return p('retry');
  return p('reprint');
}

function actionDescription() {
  if (pendingAction.value?.type === 'cancel') return p('cancelJobConfirm');
  if (pendingAction.value?.type === 'retry') return p('retryJobConfirm');
  return pendingAction.value?.row.retryBlocked
    ? p('reprintUnknownConfirm')
    : p('reprintJobConfirm');
}

async function confirmPendingAction() {
  const action = pendingAction.value;
  if (!action || actionLoading.value) return;
  actionLoading.value = true;
  try {
    if (action.type === 'cancel') await cancelJob(action.row);
    else if (action.type === 'retry') await retryJob(action.row);
    else await reprintJob(action.row);
  } finally {
    actionLoading.value = false;
    closePendingAction();
  }
}

function canCancel(row: PrintingJob) {
  return row.status === 'PENDING' || row.status === 'RETRY_WAIT';
}

function canRetry(row: PrintingJob) {
  return printingJobCanRetry(row);
}

function canReprint(row: PrintingJob) {
  return printingJobCanReprint(row);
}

function statusClass(row: PrintingJob) {
  const status = printingJobDisplayState(row);
  if (status === 'PRINTED') return 'printing-badge--success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'printing-badge--danger';
  if (status === 'PRINTING' || status === 'CLAIMED' || status === 'SUBMITTING' || status === 'SUBMITTED' || status === 'ACCEPTED') return 'printing-badge--info';
  return 'printing-badge--warning';
}

function triggerEventLabel(row: PrintingJob) {
  if (row.triggerEvent === 'TABLE_SESSION_SETTLED') return p('tableSessionSettled');
  if (row.triggerEvent === 'ORDER_COMPLETED') return p('orderCompleted');
  if (row.triggerEvent === 'MANUAL') return p('manual');
  return p('orderAccepted');
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
  <section class="printing-panel printing-jobs-page">
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
          <option value="PENDING">{{ p('waitingPrint') }}</option><option value="PRINTING">{{ p('printing') }}</option><option value="SUCCEEDED">{{ p('printSucceeded') }}</option><option value="FAILED">{{ p('printFailed') }}</option>
        </select>
      </label>
      <label class="printing-field">
        {{ p('filterSource') }}
        <select v-model="filters.source" class="printing-filter" @change="load">
          <option value="">{{ p('all') }}</option>
          <option v-for="source in sources" :key="source" :value="source">{{ sourceLabel(source) }}</option>
        </select>
      </label>
    </div>

    <p v-if="message" :class="['printing-message', { 'printing-message--success': success }]" role="status">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('createdAt') }}</th>
            <th>{{ p('orderId') }}</th>
            <th>{{ p('receiptType') }}</th>
            <th>{{ p('printer') }}</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ new Date(row.createdAt).toLocaleString() }}</td>
            <td><strong>{{ orderReference(row) }}</strong></td>
            <td>{{ receiptTypeLabel(row.receiptType) }}</td>
            <td>{{ row.printer?.name || row.printerId }}</td>
            <td><span :class="['printing-badge', statusClass(row)]">{{ statusLabel(row) }}</span><small v-if="recordHint(row)">{{ recordHint(row) }}</small></td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openDetail(row)">{{ p('view') }}</button>
                <button v-if="canCancel(row)" class="printing-button printing-button--danger printing-button--small" type="button" @click="requestAction('cancel', row)">{{ p('cancelJob') }}</button>
                <button v-if="canRetry(row)" class="printing-button printing-button--secondary printing-button--small" type="button" @click="requestAction('retry', row)">{{ p('retry') }}</button>
                <button v-if="canReprint(row)" class="printing-button printing-button--secondary printing-button--small" type="button" @click="requestAction('reprint', row)">{{ p('reprint') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="6">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="6">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="selected || detailLoading" class="printing-modal-backdrop" @click.self="closeDetail">
    <section class="printing-modal printing-modal--wide" role="dialog" aria-modal="true" aria-labelledby="printing-job-detail-title">
      <header class="printing-modal__header"><h2 id="printing-job-detail-title">{{ p('detail') }}</h2></header>
      <div class="printing-modal__body">
        <p v-if="detailLoading" class="printing-hint printing-field--full">{{ p('loading') }}</p>
        <template v-if="selected">
          <dl class="printing-detail-grid printing-field--full">
            <dt>{{ p('jobId') }}</dt><dd>{{ selected.id }}</dd>
            <dt>{{ p('status') }}</dt><dd>{{ statusLabel(selected) }}</dd>
            <dt>{{ p('orderId') }}</dt><dd>{{ selected.orderId || '—' }}</dd>
            <dt>{{ p('printer') }}</dt><dd>{{ selected.printer?.name || selected.printerId }}</dd>
            <dt>{{ p('source') }}</dt><dd>{{ sourceLabel(selected.source) }}</dd>
            <dt>{{ p('triggerEvent') }}</dt><dd>{{ triggerEventLabel(selected) }}</dd>
            <dt>{{ p('attempts') }}</dt><dd>{{ selected.attemptCount }} / {{ selected.maxAttempts }}</dd>
            <dt v-if="latestPrintingAttempt(selected)?.providerTaskId">{{ p('providerTaskId') }}</dt><dd v-if="latestPrintingAttempt(selected)?.providerTaskId">{{ latestPrintingAttempt(selected)?.providerTaskId }}</dd>
            <dt v-if="latestPrintingAttempt(selected)?.providerCheckedAt">{{ p('providerCheckedAt') }}</dt><dd v-if="latestPrintingAttempt(selected)?.providerCheckedAt">{{ new Date(latestPrintingAttempt(selected)?.providerCheckedAt || '').toLocaleString() }}</dd>
            <dt>{{ p('lastError') }}</dt><dd>{{ recordHint(selected) || '—' }}</dd>
            <dt v-if="selected.retryBlocked">{{ p('status') }}</dt><dd v-if="selected.retryBlocked" class="printing-text-danger">{{ p('outcomeUnknownHint') }}</dd>
          </dl>
          <details class="printing-advanced-template printing-field--full"><summary>{{ p('advancedRecordDetails') }}</summary><p class="printing-hint">{{ p('advancedRecordDetailsHint') }}</p><pre class="printing-json">{{ JSON.stringify(selected.receiptSnapshot ?? {}, null, 2) }}</pre></details>
        </template>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeDetail">{{ p('close') }}</button>
        <button v-if="selected && canCancel(selected)" class="printing-button printing-button--danger" type="button" @click="requestAction('cancel', selected)">{{ p('cancelJob') }}</button>
        <button v-if="selected && canRetry(selected)" class="printing-button" type="button" @click="requestAction('retry', selected)">{{ p('retry') }}</button>
        <button v-if="selected && canReprint(selected)" class="printing-button" type="button" @click="requestAction('reprint', selected)">{{ p('reprint') }}</button>
      </footer>
    </section>
  </div>

  <div v-if="pendingAction" class="printing-modal-backdrop" @click.self="closePendingAction" @keydown.esc="closePendingAction">
    <section class="printing-modal printing-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="printing-job-action-title" aria-describedby="printing-job-action-description">
      <header class="printing-modal__header"><h2 id="printing-job-action-title">{{ actionTitle() }}</h2></header>
      <div class="printing-modal__body"><p id="printing-job-action-description" class="printing-hint printing-field--full">{{ actionDescription() }}</p></div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" :disabled="actionLoading" @click="closePendingAction">{{ p('cancel') }}</button>
        <button ref="actionConfirmButton" :class="['printing-button', { 'printing-button--danger': pendingAction.type === 'cancel' }]" type="button" :disabled="actionLoading" @click="confirmPendingAction">{{ p('confirmAction') }}</button>
      </footer>
    </section>
  </div>
</template>
