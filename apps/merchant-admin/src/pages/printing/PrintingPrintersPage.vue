<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from 'vue';
import { errorMessage } from '@/api/http';
import {
  archivePrintingPrinter,
  createPrintingPrinter,
  createPrintingTestJob,
  disablePrintingPrinter,
  enablePrintingPrinter,
  getCloudPrintingExecutionState,
  getMerchantPrintingSettings,
  getPrintingJob,
  getPrintingPrinters,
  getPrintingRules,
  updatePrintingPrinter,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintingJob,
  PrintingPaperWidth,
  PrintingPrinter,
  PrintingPrinterPayload,
  PrintingRule,
} from '@/types/printing';
import {
  lanPrinterActionMatrix,
  normalizedLanSummary,
} from '@/utils/lan-printer-admin-state';
import {
  pollPrintingTestJob,
  type PrintingTestPollOutcome,
} from '@/utils/printing-test-job-polling';
import {
  printerConnectionState,
  PRINTING_STATE_CHANGED_EVENT,
  type PrinterConnectionState,
} from '@/utils/printing-status';
import { getMerchantStaff } from '@/utils/storage';

const { p } = usePrintingI18n();
const rows = ref<PrintingPrinter[]>([]);
const rules = ref<PrintingRule[]>([]);
const settings = ref<Awaited<ReturnType<typeof getMerchantPrintingSettings>> | null>(null);
const cloudExecution = ref<Awaited<ReturnType<typeof getCloudPrintingExecutionState>> | null>(null);
const loading = ref(false);
const saving = ref(false);
const actionId = ref('');
const message = ref('');
const messageKind = ref<'error' | 'info' | 'success'>('info');
const modalOpen = ref(false);
const step = ref(1);
const pendingDisable = ref<PrintingPrinter | null>(null);
const pendingArchive = ref<PrintingPrinter | null>(null);
const pendingTest = ref<PrintingPrinter | null>(null);
const selectedDetail = ref<PrintingPrinter | null>(null);
const wizardCloseButton = ref<HTMLButtonElement | null>(null);
const testConfirmButton = ref<HTMLButtonElement | null>(null);
const detailCloseButton = ref<HTMLButtonElement | null>(null);
const archiveConfirmButton = ref<HTMLButtonElement | null>(null);
const canArchive = computed(() => ['OWNER', 'MANAGER'].includes(
  getMerchantStaff()?.role ?? 'STAFF',
));

interface StoredTestJobRequest {
  requestKey: string;
  jobId?: string;
}

const TEST_JOB_REQUESTS_STORAGE = 'yunqiao.printing.testJobRequests.v2';
let activeTestController: AbortController | null = null;
let statusRefreshTimer: number | undefined;
let wizardReturnFocus: HTMLElement | null = null;
let dialogReturnFocus: HTMLElement | null = null;

const form = reactive({
  id: '',
  name: '',
  channelType: 'CLOUD_FEIE' as PrintingPrinter['channelType'],
  provider: 'CLOUD_FEIE' as 'CLOUD_FEIE' | 'CLOUD_YILIAN',
  deviceId: '',
  paperWidth: 'MM80' as PrintingPaperWidth,
});

const isCloud = computed(
  () => form.channelType === 'CLOUD_FEIE' || form.channelType === 'CLOUD_YILIAN',
);
const stepLabels = computed(() => [p('chooseMethod'), p('deviceInformation'), p('testAndSave')]);

function isLan(row: PrintingPrinter) {
  return row.channelType === 'LOCAL_LAN_ESCPOS';
}

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    channelType: 'CLOUD_FEIE',
    provider: 'CLOUD_FEIE',
    deviceId: '',
    paperWidth: 'MM80',
  });
  step.value = 1;
}

function rememberWizardFocus() {
  wizardReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function openCreate() {
  rememberWizardFocus();
  resetForm();
  modalOpen.value = true;
  void nextTick(() => wizardCloseButton.value?.focus());
}

function openEdit(row: PrintingPrinter) {
  if (isLan(row)) {
    openDetail(row);
    return;
  }
  rememberWizardFocus();
  const config = row.connectionConfig || {};
  Object.assign(form, {
    id: row.id,
    name: row.name,
    channelType: row.channelType,
    provider: row.channelType === 'CLOUD_YILIAN' ? 'CLOUD_YILIAN' : 'CLOUD_FEIE',
    deviceId: typeof config.printerSn === 'string'
      ? config.printerSn
      : typeof config.machineCode === 'string'
        ? config.machineCode
        : '',
    paperWidth: row.paperWidth,
  });
  step.value = 2;
  modalOpen.value = true;
  void nextTick(() => wizardCloseButton.value?.focus());
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
  const target = wizardReturnFocus;
  wizardReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function selectMethod(channel: PrintingPrinter['channelType']) {
  if (channel === 'LOCAL_LAN_ESCPOS') return;
  form.channelType = channel;
  form.provider = channel === 'CLOUD_YILIAN' ? 'CLOUD_YILIAN' : 'CLOUD_FEIE';
  step.value = 2;
}

function methodTitle(channel: PrintingPrinter['channelType']) {
  if (channel === 'LOCAL_USB_ESCPOS') return p('usbPrinting');
  if (channel === 'LOCAL_LAN_ESCPOS') return p('lanPrinting');
  return p('cloudPrinting');
}

function methodHint(channel: PrintingPrinter['channelType']) {
  if (channel === 'LOCAL_USB_ESCPOS') return p('usbPrintingHint');
  if (channel === 'LOCAL_LAN_ESCPOS') return p('lanPrintingHint');
  return p('cloudPrintingHint');
}

function channelLabel(channel: PrintingPrinter['channelType']) {
  if (channel === 'LOCAL_USB_ESCPOS') return p('usbPrinting');
  if (channel === 'LOCAL_LAN_ESCPOS') return p('lanPrinting');
  if (channel === 'CLOUD_FEIE') return p('feieCloudPrinting');
  return p('yilianCloudPrinting');
}

function printerUsageLabel(printer: PrintingPrinter) {
  const active = rules.value.filter(
    (rule) => rule.printerId === printer.id && rule.enabled && rule.autoPrint,
  );
  if (!active.length) return p('unassignedPrintingScenes');
  const labels = active.map((rule) => {
    if (rule.receiptType === 'TABLE_BILL') return p('checkoutScenario');
    if (rule.orderType === 'DINE_IN') return p('dineInScenario');
    if (rule.orderType === 'PICKUP') return p('pickupScenario');
    if (rule.orderType === 'DELIVERY') return p('deliveryScenario');
    return p('customerReceipt');
  });
  return labels.length > 3
    ? `${p('usedForPrintingScenesPrefix')}${labels.slice(0, 2).join('、')}${p('usedForPrintingScenesAndMore').replace('{count}', String(labels.length - 2))}`
    : `${p('usedForPrintingScenesPrefix')}${labels.join('、')}`;
}

function genericStatusLabel(state: PrinterConnectionState) {
  return ({
    CONNECTED: p('online'),
    OFFLINE: p('offline'),
    RECONNECTING: p('connecting'),
    WAITING_PERMISSION: p('connectionWaitingPermission'),
    DEVICE_NOT_DETECTED: p('offline'),
    UNKNOWN: p('statusUnknown'),
  } as Record<PrinterConnectionState, string>)[state];
}

function lanStateLabel(row: PrintingPrinter) {
  const state = lanPrinterActionMatrix(row)?.state ?? 'WAITING_TERMINAL';
  if (state === 'WAITING_TERMINAL') return p('lanWaitingTerminal');
  if (state === 'TERMINAL_OFFLINE') return p('lanTerminalOffline');
  if (state === 'WAITING_TEST') return p('lanWaitingTest');
  if (state === 'ONLINE_DISABLED') return p('lanOnline');
  return p('lanEnabledState');
}

function lanStateHint(row: PrintingPrinter) {
  const state = lanPrinterActionMatrix(row)?.state ?? 'WAITING_TERMINAL';
  if (state === 'WAITING_TERMINAL') return p('lanWaitingTerminalHint');
  if (state === 'TERMINAL_OFFLINE') return p('lanTerminalOfflineHint');
  if (state === 'WAITING_TEST') return p('lanWaitingTestHint');
  if (state === 'ONLINE_DISABLED') return p('lanOnlineHint');
  return p('lanEnabledHint');
}

function rowStatusLabel(row: PrintingPrinter) {
  if (isLan(row)) return lanStateLabel(row);
  const state = printerConnectionState(row);
  if (row.channelType === 'LOCAL_USB_ESCPOS' && state === 'CONNECTED') {
    return row.enabled ? p('usbOnlineEnabled') : p('usbOnlinePendingEnable');
  }
  return genericStatusLabel(state);
}

function rowStatusClass(row: PrintingPrinter) {
  if (isLan(row)) {
    const state = lanPrinterActionMatrix(row)?.state ?? 'WAITING_TERMINAL';
    if (state === 'ONLINE_DISABLED' || state === 'ENABLED') return 'printing-badge--success';
    if (state === 'TERMINAL_OFFLINE') return 'printing-badge--danger';
    return 'printing-badge--warning';
  }
  const state = printerConnectionState(row);
  if (state === 'CONNECTED') return 'printing-badge--success';
  if (state === 'OFFLINE' || state === 'DEVICE_NOT_DETECTED') return 'printing-badge--danger';
  return 'printing-badge--warning';
}

function connectionConfig() {
  if (form.channelType === 'LOCAL_USB_ESCPOS') return {};
  return form.channelType === 'CLOUD_FEIE'
    ? { printerSn: form.deviceId.trim() }
    : { machineCode: form.deviceId.trim() };
}

function payload(): PrintingPrinterPayload {
  return {
    name: form.name.trim(),
    channelType: form.channelType,
    paperWidth: form.paperWidth,
    enabled: true,
    connectionConfig: connectionConfig(),
  };
}

function updatePayload(): Partial<PrintingPrinterPayload> {
  return {
    name: form.name.trim(),
    paperWidth: form.paperWidth,
    connectionConfig: connectionConfig(),
  };
}

function canNext() {
  if (step.value === 1) return Boolean(form.channelType);
  if (step.value === 2) {
    return Boolean(form.name.trim())
      && (form.channelType === 'LOCAL_USB_ESCPOS' || Boolean(form.deviceId.trim()));
  }
  return true;
}

function nextStep() {
  if (canNext()) step.value = Math.min(3, step.value + 1);
}

function previousStep() {
  step.value = Math.max(1, step.value - 1);
}

async function load(showLoading = true) {
  if (loading.value) return;
  try {
    if (showLoading) loading.value = true;
    [rows.value, settings.value, rules.value, cloudExecution.value] = await Promise.all([
      getPrintingPrinters(),
      getMerchantPrintingSettings(),
      getPrintingRules(),
      getCloudPrintingExecutionState(),
    ]);
  } catch (error) {
    showError(error);
  } finally {
    if (showLoading) loading.value = false;
  }
}

async function save() {
  if (saving.value || !canNext()) return;
  try {
    saving.value = true;
    if (form.id) await updatePrintingPrinter(form.id, updatePayload());
    else await createPrintingPrinter(payload());
    closeModal();
    await load();
    notifyPrintingStateChanged();
    showSuccess(`${p('printerSaved')} · ${p('printerSavedHint')}`);
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

function readTestJobRequests(): Record<string, StoredTestJobRequest> {
  try {
    const value = JSON.parse(localStorage.getItem(TEST_JOB_REQUESTS_STORAGE) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, StoredTestJobRequest] => {
        const candidate = entry[1];
        return Boolean(
          candidate
          && typeof candidate === 'object'
          && !Array.isArray(candidate)
          && typeof (candidate as StoredTestJobRequest).requestKey === 'string',
        );
      }),
    );
  } catch {
    return {};
  }
}

function storedTestJobRequest(printerId: string) {
  const requests = readTestJobRequests();
  if (requests[printerId]) return requests[printerId];
  const request: StoredTestJobRequest = { requestKey: `admin.${crypto.randomUUID()}` };
  requests[printerId] = request;
  localStorage.setItem(TEST_JOB_REQUESTS_STORAGE, JSON.stringify(requests));
  return request;
}

function updateStoredTestJobRequest(printerId: string, request: StoredTestJobRequest) {
  const requests = readTestJobRequests();
  requests[printerId] = request;
  localStorage.setItem(TEST_JOB_REQUESTS_STORAGE, JSON.stringify(requests));
}

function clearStoredTestJobRequest(printerId: string) {
  const requests = readTestJobRequests();
  delete requests[printerId];
  localStorage.setItem(TEST_JOB_REQUESTS_STORAGE, JSON.stringify(requests));
}

function cloudProviderConfigured(row: PrintingPrinter) {
  const provider = row.channelType === 'CLOUD_FEIE'
    ? 'FEIE'
    : row.channelType === 'CLOUD_YILIAN'
      ? 'YILIAN'
      : null;
  return provider ? cloudExecution.value?.providers[provider].configured === true : false;
}

function testPrintAvailable(row: PrintingPrinter) {
  if (isLan(row)) return lanPrinterActionMatrix(row)?.canTest === true;
  if (!row.enabled || !settings.value?.featureFlags.executionEnabled) return false;
  if (row.channelType === 'LOCAL_USB_ESCPOS') return true;
  if (row.channelType === 'CLOUD_FEIE' || row.channelType === 'CLOUD_YILIAN') {
    return cloudExecution.value?.enabled === true && cloudProviderConfigured(row);
  }
  return false;
}

function lanBlockReason(row: PrintingPrinter) {
  const reason = normalizedLanSummary(row)?.enableBlockReason;
  if (reason === 'LAN_BINDING_MISSING') return p('lanBindingMissing');
  if (reason === 'TERMINAL_OFFLINE') return p('lanTerminalOfflineHint');
  if (reason === 'CONNECTOR_SERVICE_STOPPED') return p('lanServiceStopped');
  if (reason === 'TEST_PRINT_REQUIRED') return p('lanWaitingTestHint');
  if (reason === 'LAN_PRINTING_DISABLED') return p('lanEmergencyDisabled');
  return reason || lanStateHint(row);
}

function testPrintUnavailableHint(row: PrintingPrinter) {
  if (isLan(row)) return lanBlockReason(row);
  if (!settings.value?.featureFlags.executionEnabled) return p('printingExecutionUnavailable');
  if (
    (row.channelType === 'CLOUD_FEIE' || row.channelType === 'CLOUD_YILIAN')
    && !cloudProviderConfigured(row)
  ) return p('cloudProviderContactAdmin');
  if (
    (row.channelType === 'CLOUD_FEIE' || row.channelType === 'CLOUD_YILIAN')
    && !cloudExecution.value?.enabled
  ) return p('cloudWorkerUnavailable');
  return p('printErrorUnknown');
}

function rememberDialogFocus() {
  dialogReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function requestTest(row: PrintingPrinter) {
  if (!testPrintAvailable(row) || actionId.value) {
    if (!testPrintAvailable(row)) showError(new Error(testPrintUnavailableHint(row)));
    return;
  }
  rememberDialogFocus();
  pendingTest.value = row;
  void nextTick(() => testConfirmButton.value?.focus());
}

function closeTestConfirmation(restoreFocus = true) {
  pendingTest.value = null;
  if (!restoreFocus) return;
  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function failedTestMessage(job: PrintingJob | null, row: PrintingPrinter) {
  const code = job?.latestAttempt?.errorCode || job?.lastErrorCode;
  if (code === 'LAN_CONNECTION_FAILED') return p('lanConnectionError');
  if (code === 'PRINTER_OFFLINE') return p('printerOfflineError');
  if (code === 'PRINT_TIMEOUT' || code === 'NETWORK_TIMEOUT') return p('printTimeoutError');
  if (code === 'TERMINAL_OFFLINE') return p('lanTerminalOfflineHint');
  if (code === 'CONNECTOR_SERVICE_STOPPED') return p('lanServiceStopped');
  if (code === 'LAN_BINDING_MISSING') return p('lanBindingMissing');
  return job?.latestAttempt?.errorMessage
    || job?.lastErrorMessage
    || `${p('testPrintFailed')} · ${row.name}`;
}

function testOutcomeMessage(
  outcome: PrintingTestPollOutcome,
  row: PrintingPrinter,
  job: PrintingJob | null,
) {
  if (outcome === 'SUCCEEDED') {
    showSuccess(`${p('testPrintSucceeded')} · ${p('testPrintSucceededHint')}`);
    return;
  }
  if (outcome === 'UNCERTAIN') {
    showError(new Error(`${p('testPrintUncertain')} · ${p('testPrintUncertainHint')}`));
    return;
  }
  if (outcome === 'TIMEOUT') {
    showInfo(`${p('testPrintTimedOut')} · ${p('testPrintTimedOutHint')}`);
    return;
  }
  if (outcome === 'FAILED') {
    showError(new Error(failedTestMessage(job, row)));
  }
}

async function confirmTestPrint() {
  const row = pendingTest.value;
  if (!row || actionId.value) return;
  closeTestConfirmation(false);
  activeTestController?.abort();
  activeTestController = new AbortController();
  const controller = activeTestController;
  const request = storedTestJobRequest(row.id);

  try {
    actionId.value = row.id;
    showInfo(p('testPrintSending'));
    let jobId = request.jobId;
    if (!jobId) {
      const job = await createPrintingTestJob(row.id, request.requestKey);
      jobId = job.id;
      updateStoredTestJobRequest(row.id, { ...request, jobId });
    }
    const result = await pollPrintingTestJob(jobId, getPrintingJob, {
      signal: controller.signal,
    });
    if (result.outcome === 'ABORTED') return;
    if (result.outcome !== 'TIMEOUT') clearStoredTestJobRequest(row.id);
    testOutcomeMessage(result.outcome, row, result.job);
    await load(false);
    notifyPrintingStateChanged();
  } catch (error) {
    if (!controller.signal.aborted) showError(error);
  } finally {
    if (activeTestController === controller) activeTestController = null;
    actionId.value = '';
    const target = dialogReturnFocus;
    dialogReturnFocus = null;
    void nextTick(() => {
      if (target?.isConnected) target.focus();
    });
  }
}

function openDetail(row: PrintingPrinter) {
  rememberDialogFocus();
  selectedDetail.value = row;
  void nextTick(() => detailCloseButton.value?.focus());
}

function closeDetail() {
  selectedDetail.value = null;
  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function requestToggle(row: PrintingPrinter) {
  if (row.enabled || lanPrinterActionMatrix(row)?.canDisable) {
    pendingDisable.value = row;
    return;
  }
  if (isLan(row) && !lanPrinterActionMatrix(row)?.canEnable) {
    showError(new Error(lanBlockReason(row)));
    return;
  }
  void setEnabled(row, true);
}

async function confirmDisable() {
  const row = pendingDisable.value;
  pendingDisable.value = null;
  if (row) await setEnabled(row, false);
}

function requestArchive(row: PrintingPrinter) {
  if (!canArchive.value || actionId.value) return;
  rememberDialogFocus();
  pendingArchive.value = row;
  void nextTick(() => archiveConfirmButton.value?.focus());
}

function closeArchiveConfirmation(restoreFocus = true) {
  pendingArchive.value = null;
  if (!restoreFocus) return;
  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
}

function printingErrorCode(error: unknown) {
  const response = (error as { response?: { data?: { code?: unknown } } })?.response;
  return typeof response?.data?.code === 'string' ? response.data.code : null;
}

async function confirmArchive() {
  const row = pendingArchive.value;
  if (!row || actionId.value) return;
  closeArchiveConfirmation(false);
  try {
    actionId.value = row.id;
    await archivePrintingPrinter(row.id, '用户移除打印机');
    if (selectedDetail.value?.id === row.id) selectedDetail.value = null;
    await load(false);
    notifyPrintingStateChanged();
    showSuccess(p('printerArchived'));
  } catch (error) {
    if (printingErrorCode(error) === 'PRINTER_HAS_ACTIVE_JOBS') {
      showError(new Error(p('archivePrinterActiveJobsError')));
    } else {
      showError(error);
    }
  } finally {
    actionId.value = '';
    const target = dialogReturnFocus;
    dialogReturnFocus = null;
    void nextTick(() => {
      if (target?.isConnected) target.focus();
    });
  }
}

async function setEnabled(row: PrintingPrinter, enabled: boolean) {
  if (actionId.value) return;
  if (enabled && isLan(row) && !lanPrinterActionMatrix(row)?.canEnable) {
    showError(new Error(lanBlockReason(row)));
    return;
  }
  try {
    actionId.value = row.id;
    if (enabled) {
      if (isLan(row)) await enablePrintingPrinter(row.id);
      else await updatePrintingPrinter(row.id, { enabled: true });
    } else {
      await disablePrintingPrinter(row.id);
    }
    await load(false);
    notifyPrintingStateChanged();
    showSuccess(enabled
      ? `${p('printerEnabled')} · ${p('goAutoPrintAfterEnable')}`
      : p('printerDisabled'));
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

function formatTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return p('notReported');
  return new Date(value).toLocaleString();
}

function lanEndpoint(row: PrintingPrinter) {
  const endpoint = normalizedLanSummary(row)?.endpoint;
  return endpoint ? `${endpoint.host}:${endpoint.port}` : p('notReported');
}

function archiveTerminalLabel(row: PrintingPrinter) {
  return normalizedLanSummary(row)?.terminal?.name
    || row.boundTerminal?.name
    || p('notReported');
}

function usbDeviceLabel(row: PrintingPrinter) {
  const evidence = { ...(row.connectionConfig || {}), ...(row.capabilities || {}) };
  const parts = [
    'productName',
    'manufacturerName',
    'usbVendorId',
    'usbProductId',
    'usbSerialNumber',
    'vendorId',
    'productId',
    'serialNumber',
  ]
    .map((key) => evidence[key])
    .filter((value) => typeof value === 'string' || typeof value === 'number');
  return parts.length ? parts.join(' / ') : p('usbConfiguredOnTerminal');
}

function latestTestLabel(row: PrintingPrinter) {
  const latest = normalizedLanSummary(row)?.lastTest;
  if (!latest) return p('noTestYet');
  if (
    latest.lastErrorCode === 'PRINT_OUTCOME_UNKNOWN'
    || latest.attemptResult === 'OUTCOME_UNKNOWN'
  ) return `${p('testPrintUncertain')} · ${formatTime(latest.completedAt)}`;
  if (latest.status === 'SUCCEEDED') {
    return `${p('testPrintSucceeded')} · ${formatTime(latest.completedAt)}`;
  }
  if (latest.status === 'FAILED' || latest.status === 'CANCELLED') {
    return `${p('testPrintFailed')} · ${formatTime(latest.completedAt)}`;
  }
  return `${p('testPrintSending')} · #${latest.id}`;
}

function showError(error: unknown) {
  messageKind.value = 'error';
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  messageKind.value = 'success';
  message.value = value;
}

function showInfo(value: string) {
  messageKind.value = 'info';
  message.value = value;
}

function notifyPrintingStateChanged() {
  window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
}

onMounted(() => {
  void load();
  statusRefreshTimer = window.setInterval(() => {
    if (
      document.visibilityState === 'visible'
      && !modalOpen.value
      && !selectedDetail.value
      && !pendingTest.value
      && !pendingArchive.value
      && !actionId.value
    ) void load(false);
  }, 15_000);
});

onBeforeUnmount(() => {
  activeTestController?.abort();
  activeTestController = null;
  if (statusRefreshTimer !== undefined) window.clearInterval(statusRefreshTimer);
});
</script>

<template>
  <section class="printing-panel printing-printers-page">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('printers') }}</h2>
        <p>{{ p('printerListDescription') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load()">{{ p('refresh') }}</button>
        <button class="printing-button" type="button" @click="openCreate">{{ p('addPrinter') }}</button>
      </div>
    </div>

    <p
      v-if="message"
      :class="[
        'printing-message',
        { 'printing-message--success': messageKind === 'success', 'printing-message--info': messageKind === 'info' },
      ]"
      :role="messageKind === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >
      {{ message }}
    </p>

    <div v-if="loading" class="printing-empty-state"><strong>{{ p('loading') }}</strong></div>
    <div v-else-if="!rows.length" class="printing-empty-state">
      <div class="printing-empty-state__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 7h14v12H5zM8 7V5h8v2m-8 5h8m-8 3h5" /></svg>
      </div>
      <strong>{{ p('noPrinters') }}</strong>
      <p>{{ p('noPrintersHint') }}</p>
      <button class="printing-button" type="button" @click="openCreate">{{ p('addPrinter') }}</button>
    </div>

    <div v-else class="printing-printer-list">
      <article v-for="row in rows" :key="row.id" class="printing-printer-row">
        <div class="printing-printer-row__identity">
          <div class="printing-printer-row__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 9h12v9H6zM8 9V5h8v4m-5 4h4m-5 3h6" /></svg>
          </div>
          <div>
            <strong>{{ row.name }}</strong>
            <span>{{ channelLabel(row.channelType) }} · {{ printerUsageLabel(row) }}</span>
          </div>
        </div>
        <span :class="['printing-badge', rowStatusClass(row)]">{{ rowStatusLabel(row) }}</span>

        <div v-if="isLan(row)" class="printing-actions">
          <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openDetail(row)">
            {{ lanPrinterActionMatrix(row)?.showInstructions ? p('viewInstructions') : p('details') }}
          </button>
          <button
            v-if="['WAITING_TEST', 'ONLINE_DISABLED', 'ENABLED'].includes(lanPrinterActionMatrix(row)?.state || '')"
            class="printing-button printing-button--secondary printing-button--small"
            type="button"
            :disabled="actionId === row.id || !testPrintAvailable(row)"
            @click="requestTest(row)"
          >
            {{ actionId === row.id ? p('testPrintSending') : p('testPrint') }}
          </button>
          <button
            v-if="lanPrinterActionMatrix(row)?.state === 'ONLINE_DISABLED'"
            class="printing-button printing-button--small"
            type="button"
            :disabled="actionId === row.id || !lanPrinterActionMatrix(row)?.canEnable"
            @click="requestToggle(row)"
          >
            {{ p('enable') }}
          </button>
          <button
            v-if="lanPrinterActionMatrix(row)?.canDisable"
            class="printing-button printing-button--secondary printing-button--small"
            type="button"
            :disabled="actionId === row.id"
            @click="requestToggle(row)"
          >
            {{ p('disable') }}
          </button>
          <button
            v-if="canArchive"
            class="printing-button printing-button--danger printing-button--small"
            type="button"
            :disabled="actionId === row.id"
            @click="requestArchive(row)"
          >
            {{ p('archivePrinter') }}
          </button>
        </div>

        <div v-else class="printing-actions">
          <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openEdit(row)">{{ p('settings') }}</button>
          <button
            class="printing-button printing-button--secondary printing-button--small"
            type="button"
            :disabled="actionId === row.id || !testPrintAvailable(row)"
            @click="requestTest(row)"
          >
            {{ actionId === row.id ? p('testPrintSending') : p('testPrint') }}
          </button>
          <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="requestToggle(row)">
            {{ row.enabled ? p('disable') : p('enable') }}
          </button>
          <button
            v-if="canArchive"
            class="printing-button printing-button--danger printing-button--small"
            type="button"
            :disabled="actionId === row.id"
            @click="requestArchive(row)"
          >
            {{ p('archivePrinter') }}
          </button>
        </div>

        <div v-if="isLan(row)" class="printing-inline-note printing-printer-row__notice">
          <strong>{{ lanStateLabel(row) }}</strong>
          <span>{{ lanStateHint(row) }}</span>
          <span v-if="!testPrintAvailable(row) && ['WAITING_TEST', 'ONLINE_DISABLED', 'ENABLED'].includes(lanPrinterActionMatrix(row)?.state || '')">
            {{ testPrintUnavailableHint(row) }}
          </span>
        </div>
        <p v-else-if="!testPrintAvailable(row)" class="printing-hint printing-printer-row__notice">{{ testPrintUnavailableHint(row) }}</p>
      </article>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal" @keydown.esc="closeModal">
    <form
      class="printing-modal printing-modal--printer-flow"
      role="dialog"
      aria-modal="true"
      aria-labelledby="printing-printer-form-title"
      @submit.prevent="step === 3 ? save() : nextStep()"
    >
      <header class="printing-modal__header">
        <div><span class="printing-modal__eyebrow">{{ p('addPrinter') }}</span><h2 id="printing-printer-form-title">{{ form.id ? p('editPrinter') : p('newPrinterTitle') }}</h2></div>
        <button ref="wizardCloseButton" class="printing-modal__close" type="button" :aria-label="p('close')" @click="closeModal">×</button>
      </header>
      <div class="printing-flow-steps">
        <div v-for="(label, index) in stepLabels" :key="label" :class="['printing-flow-step', { 'is-active': step === index + 1, 'is-complete': step > index + 1 }]">
          <span>{{ index + 1 }}</span><b>{{ label }}</b>
        </div>
      </div>
      <div class="printing-modal__body">
        <template v-if="step === 1">
          <div class="printing-step-copy printing-field--full"><span class="printing-step-kicker">{{ p('stepOne') }}</span><h3>{{ p('choosePrintingMethod') }}</h3><p>{{ p('choosePrintingMethodHint') }}</p></div>
          <div class="printing-method-grid printing-method-grid--two printing-field--full">
            <button
              v-for="method in (['CLOUD_FEIE'] as const)"
              :key="method"
              :class="['printing-method-card', { 'is-selected': isCloud }]"
              type="button"
              @click="selectMethod(method)"
            >
              <span class="printing-method-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M7 17h10a3 3 0 0 0 .2-6A5.5 5.5 0 0 0 6.5 9.5 3.5 3.5 0 0 0 7 17Z" /></svg>
              </span>
              <strong>{{ methodTitle(method) }}</strong>
              <small>{{ methodHint(method) }}</small>
              <i v-if="isCloud">✓</i>
            </button>
          </div>
          <div class="printing-inline-note printing-field--full"><strong>{{ p('lanPrinting') }}</strong><span>{{ p('lanAddOnTerminalHint') }}</span></div>
        </template>

        <template v-else-if="step === 2">
          <div class="printing-step-copy printing-field--full"><span class="printing-step-kicker">{{ p('stepTwo') }}</span><h3>{{ p('deviceInformation') }}</h3><p>{{ p('printerConnectionInfoHint') }}</p></div>
          <label class="printing-field printing-field--full">{{ p('printerName') }}<input v-model="form.name" required maxlength="80" :placeholder="p('printerNamePlaceholder')" /></label>
          <div v-if="form.channelType === 'LOCAL_USB_ESCPOS'" class="printing-inline-note printing-field--full"><strong>{{ p('connectedDevice') }}</strong><span>{{ p('usbAutoDetectHint') }}</span></div>
          <template v-if="isCloud">
            <label class="printing-field">{{ p('cloudProvider') }}<select v-model="form.provider" @change="form.channelType = form.provider"><option value="CLOUD_FEIE">{{ p('feieCloudPrinting') }}</option><option value="CLOUD_YILIAN">{{ p('yilianCloudPrinting') }}</option></select></label>
            <label class="printing-field">{{ form.provider === 'CLOUD_FEIE' ? p('printerNumber') : p('terminalNumber') }}<input v-model="form.deviceId" required /></label>
            <div class="printing-inline-note printing-field--full"><strong>{{ p('cloudSecretLabel') }}</strong><span>{{ p('cloudSecretServerHint') }}</span></div>
          </template>
          <label class="printing-field">{{ p('paperWidth') }}<select v-model="form.paperWidth"><option value="MM58">58 mm</option><option value="MM80">80 mm</option></select></label>
        </template>

        <template v-else>
          <div class="printing-step-copy printing-field--full"><span class="printing-step-kicker">{{ p('stepThree') }}</span><h3>{{ p('testAndSave') }}</h3><p>{{ p('testAndSaveHint') }}</p></div>
          <div class="printing-review-card printing-field--full">
            <div><span>{{ p('printerName') }}</span><strong>{{ form.name || '—' }}</strong></div>
            <div><span>{{ p('printingMethod') }}</span><strong>{{ isCloud ? (form.provider === 'CLOUD_FEIE' ? p('feieCloudPrinting') : p('yilianCloudPrinting')) : methodTitle(form.channelType) }}</strong></div>
            <div><span>{{ p('paperWidth') }}</span><strong>{{ form.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</strong></div>
          </div>
          <div class="printing-test-actions printing-field--full"><button class="printing-button printing-button--secondary" type="button" disabled>{{ isCloud ? p('verifyDevice') : p('testPrint') }}</button><span>{{ p('testBeforeSaveHint') }}</span></div>
        </template>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="step === 1 ? closeModal() : previousStep()">{{ step === 1 ? p('cancel') : p('previousStep') }}</button>
        <button class="printing-button" type="submit" :disabled="saving || !canNext()">{{ saving ? p('saving') : step === 3 ? p('savePrinter') : p('nextStep') }}</button>
      </footer>
    </form>
  </div>

  <div v-if="selectedDetail" class="printing-modal-backdrop" @click.self="closeDetail" @keydown.esc="closeDetail">
    <section class="printing-modal printing-modal--wide" role="dialog" aria-modal="true" :aria-labelledby="`lan-printer-detail-${selectedDetail.id}`">
      <header class="printing-modal__header">
        <div><span class="printing-modal__eyebrow">{{ p('lanPrinting') }}</span><h2 :id="`lan-printer-detail-${selectedDetail.id}`">{{ selectedDetail.name }}</h2></div>
        <button ref="detailCloseButton" class="printing-modal__close" type="button" :aria-label="p('close')" @click="closeDetail">×</button>
      </header>
      <div class="printing-modal__body">
        <div class="printing-inline-note printing-field--full">
          <strong>{{ lanStateLabel(selectedDetail) }}</strong>
          <span>{{ lanStateHint(selectedDetail) }}</span>
        </div>
        <dl class="printing-detail-grid printing-field--full">
          <dt>{{ p('printerName') }}</dt><dd>{{ selectedDetail.name }}</dd>
          <dt>{{ p('printingMethod') }}</dt><dd>{{ p('lanPrinting') }}</dd>
          <dt>{{ p('targetTerminal') }}</dt><dd>{{ normalizedLanSummary(selectedDetail)?.terminal?.name || p('notReported') }}</dd>
          <dt>{{ p('terminalModel') }}</dt><dd>{{ normalizedLanSummary(selectedDetail)?.terminal?.deviceModel || p('notReported') }}</dd>
          <dt>{{ p('appVersion') }}</dt><dd>{{ normalizedLanSummary(selectedDetail)?.terminal?.appVersion || p('notReported') }}</dd>
          <dt>{{ p('lanEndpoint') }}</dt><dd>{{ lanEndpoint(selectedDetail) }}</dd>
          <dt>{{ p('paperWidth') }}</dt><dd>{{ selectedDetail.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</dd>
          <dt>{{ p('lastConnectedAt') }}</dt><dd>{{ formatTime(normalizedLanSummary(selectedDetail)?.lastConnectedAt) }}</dd>
          <dt>{{ p('lastStatusReport') }}</dt><dd>{{ formatTime(normalizedLanSummary(selectedDetail)?.statusUpdatedAt) }}</dd>
          <dt>{{ p('lastTestPrint') }}</dt><dd>{{ latestTestLabel(selectedDetail) }}</dd>
          <dt>{{ p('enableStatus') }}</dt><dd>{{ selectedDetail.enabled ? p('enabled') : p('disabled') }}</dd>
          <dt>{{ p('automaticRules') }}</dt><dd>{{ printerUsageLabel(selectedDetail) }}</dd>
        </dl>
        <div class="printing-inline-note printing-field--full"><strong>{{ p('readOnlyConnection') }}</strong><span>{{ p('lanModifyOnTerminalHint') }}</span></div>
        <div class="printing-inline-note printing-field--full"><strong>{{ p('lanEscPosCompatibilityTitle') }}</strong><span>{{ p('lanEscPosCompatibilityHint') }}</span></div>
      </div>
      <footer class="printing-modal__footer"><button class="printing-button" type="button" @click="closeDetail">{{ p('close') }}</button></footer>
    </section>
  </div>

  <div v-if="pendingTest" class="printing-modal-backdrop" @click.self="closeTestConfirmation()" @keydown.esc="closeTestConfirmation()">
    <section class="printing-modal printing-confirm-modal" role="dialog" aria-modal="true" :aria-labelledby="`test-printer-${pendingTest.id}`">
      <header class="printing-modal__header">
        <div><span class="printing-modal__eyebrow">{{ p('testPrint') }}</span><h2 :id="`test-printer-${pendingTest.id}`">{{ p('testPrintTargetTitle') }}</h2></div>
        <button class="printing-modal__close" type="button" :aria-label="p('close')" @click="closeTestConfirmation()">×</button>
      </header>
      <div class="printing-modal__body">
        <p class="printing-hint printing-field--full">{{ p('confirmTestPrint') }}</p>
        <dl class="printing-detail-grid printing-field--full">
          <dt>{{ p('printerName') }}</dt><dd>{{ pendingTest.name }}</dd>
          <template v-if="isLan(pendingTest)">
            <dt>{{ p('targetTerminal') }}</dt><dd>{{ normalizedLanSummary(pendingTest)?.terminal?.name || p('notReported') }}</dd>
          </template>
        </dl>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeTestConfirmation()">{{ p('cancel') }}</button>
        <button ref="testConfirmButton" class="printing-button" type="button" @click="confirmTestPrint">{{ p('confirmAction') }}</button>
      </footer>
    </section>
  </div>

  <div v-if="pendingDisable" class="printing-modal-backdrop" @click.self="pendingDisable = null" @keydown.esc="pendingDisable = null">
    <section class="printing-modal printing-confirm-modal" role="dialog" aria-modal="true" :aria-labelledby="`disable-printer-${pendingDisable.id}`">
      <header class="printing-modal__header"><div><span class="printing-modal__eyebrow">{{ p('printer') }}</span><h2 :id="`disable-printer-${pendingDisable.id}`">{{ p('disable') }}{{ pendingDisable.name }}</h2></div><button class="printing-modal__close" type="button" :aria-label="p('close')" @click="pendingDisable = null">×</button></header>
      <div class="printing-modal__body"><p class="printing-hint printing-field--full">{{ p('disablePrinterConfirm') }}</p></div>
      <footer class="printing-modal__footer"><button class="printing-button printing-button--secondary" type="button" @click="pendingDisable = null">{{ p('cancel') }}</button><button class="printing-button printing-button--danger" type="button" @click="confirmDisable">{{ p('confirmAction') }}</button></footer>
    </section>
  </div>

  <div v-if="pendingArchive" class="printing-modal-backdrop" @click.self="closeArchiveConfirmation()" @keydown.esc="closeArchiveConfirmation()">
    <section class="printing-modal printing-confirm-modal" role="dialog" aria-modal="true" :aria-labelledby="`archive-printer-${pendingArchive.id}`">
      <header class="printing-modal__header">
        <div><span class="printing-modal__eyebrow">{{ p('dangerousAction') }}</span><h2 :id="`archive-printer-${pendingArchive.id}`">{{ p('archivePrinter') }}</h2></div>
        <button class="printing-modal__close" type="button" :aria-label="p('close')" @click="closeArchiveConfirmation()">×</button>
      </header>
      <div class="printing-modal__body">
        <p class="printing-hint printing-field--full">{{ p('archivePrinterDescription') }}</p>
        <dl class="printing-detail-grid printing-field--full">
          <dt>{{ p('printerName') }}</dt><dd>{{ pendingArchive.name }}</dd>
          <dt>{{ p('printingMethod') }}</dt><dd>{{ channelLabel(pendingArchive.channelType) }}</dd>
          <dt>{{ p('targetTerminal') }}</dt><dd>{{ archiveTerminalLabel(pendingArchive) }}</dd>
          <template v-if="isLan(pendingArchive)">
            <dt>{{ p('lanEndpoint') }}</dt><dd>{{ lanEndpoint(pendingArchive) }}</dd>
          </template>
          <template v-else-if="pendingArchive.channelType === 'LOCAL_USB_ESCPOS'">
            <dt>{{ p('usbDeviceInformation') }}</dt><dd>{{ usbDeviceLabel(pendingArchive) }}</dd>
          </template>
        </dl>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeArchiveConfirmation()">{{ p('cancel') }}</button>
        <button ref="archiveConfirmButton" class="printing-button printing-button--danger" type="button" @click="confirmArchive">{{ p('confirmArchivePrinter') }}</button>
      </footer>
    </section>
  </div>
</template>
