<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPrintingPrinter,
  createPrintingTestJob,
  disablePrintingPrinter,
  getMerchantPrintingSettings,
  getPrintingPrinters,
  updatePrintingPrinter,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  MerchantPrintingSettings,
  PrinterPurpose,
  PrintingPaperWidth,
  PrintingPrinter,
  PrintingPrinterPayload,
} from '@/types/printing';
import {
  printerConfigurationState,
  printerConnectionState,
  printerLastConnectedAt,
  PRINTING_STATE_CHANGED_EVENT,
  type PrinterConfigurationState,
  type PrinterConnectionState,
} from '@/utils/printing-status';

const { p } = usePrintingI18n();
const rows = ref<PrintingPrinter[]>([]);
const settings = ref<MerchantPrintingSettings | null>(null);
const loading = ref(false);
const saving = ref(false);
const actionId = ref('');
const message = ref('');
const success = ref(false);
const modalOpen = ref(false);
const TEST_JOB_REQUEST_KEYS_STORAGE = 'yunqiao.printing.testJobRequestKeys.v1';

const form = reactive({
  id: '',
  name: '',
  paperWidth: 'MM80' as PrintingPaperWidth,
  purpose: 'FRONT_DESK' as PrinterPurpose,
});

const purposes: PrinterPurpose[] = ['FRONT_DESK', 'KITCHEN', 'BAR', 'LABEL'];

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
  });
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: PrintingPrinter) {
  if (row.channelType !== 'LOCAL_USB_ESCPOS') {
    showError(new Error(p('notImplementedChannel')));
    return;
  }
  Object.assign(form, {
    id: row.id,
    name: row.name,
    paperWidth: row.paperWidth,
    purpose: row.purpose,
  });
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function buildCreatePayload(): PrintingPrinterPayload {
  return {
    name: form.name.trim(),
    channelType: 'LOCAL_USB_ESCPOS',
    paperWidth: form.paperWidth,
    purpose: form.purpose,
    // Safety invariant: new printer inventory is never armed by creation.
    enabled: false,
    // USB identity/interface/endpoint are discovered and stored by the Android connector.
    connectionConfig: {},
  };
}

function buildUpdatePayload(): Partial<PrintingPrinterPayload> {
  return {
    name: form.name.trim(),
    paperWidth: form.paperWidth,
    purpose: form.purpose,
  };
}

async function load() {
  try {
    loading.value = true;
    [rows.value, settings.value] = await Promise.all([
      getPrintingPrinters(),
      getMerchantPrintingSettings(),
    ]);
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function save() {
  try {
    saving.value = true;
    if (form.id) {
      // Runtime USB evidence belongs to the connector and is never overwritten by this form.
      await updatePrintingPrinter(form.id, buildUpdatePayload());
    } else {
      await createPrintingPrinter(buildCreatePayload());
    }
    closeModal();
    await load();
    notifyPrintingStateChanged();
    showSuccess(p('printerSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(row: PrintingPrinter) {
  const confirmKey = row.enabled ? 'disablePrinterConfirm' : 'enablePrinterConfirm';
  if (!window.confirm(p(confirmKey))) return;
  try {
    actionId.value = row.id;
    if (row.enabled) {
      await disablePrintingPrinter(row.id);
      showSuccess(p('printerDisabled'));
    } else {
      await updatePrintingPrinter(row.id, { enabled: true });
      showSuccess(p('printerEnabled'));
    }
    await load();
    notifyPrintingStateChanged();
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

function canCreateTestJob(row: PrintingPrinter) {
  return Boolean(
    printerConnectionState(row) === 'CONNECTED' &&
      printerConfigurationState(row) === 'CONFIGURED' &&
      settings.value?.printingEnabled &&
      settings.value.featureFlags.taskCenterEnabled &&
      settings.value.featureFlags.executionEnabled,
  );
}

function capabilityLabel() {
  if (!settings.value) return p('stateUnavailable');
  return settings.value.printingEnabled ? p('capabilityEnabled') : p('capabilityDisabled');
}

function configurationLabel(state: PrinterConfigurationState) {
  if (state === 'CONFIGURED') return p('configurationConfigured');
  if (state === 'DISABLED') return p('configurationDisabled');
  return p('configurationNotConfigured');
}

function connectionLabel(state: PrinterConnectionState) {
  const labels = {
    CONNECTED: p('connectionConnected'),
    OFFLINE: p('connectionOffline'),
    RECONNECTING: p('connectionReconnecting'),
    WAITING_PERMISSION: p('connectionWaitingPermission'),
    DEVICE_NOT_DETECTED: p('connectionDeviceNotDetected'),
    UNKNOWN: p('connectionUnknown'),
  };
  return labels[state];
}

function connectionBadgeClass(state: PrinterConnectionState) {
  if (state === 'CONNECTED') return 'printing-badge--success';
  if (state === 'OFFLINE' || state === 'DEVICE_NOT_DETECTED') {
    return 'printing-badge--danger';
  }
  return 'printing-badge--warning';
}

function evidenceLabel(row: PrintingPrinter) {
  const value = row.readiness?.evidenceUpdatedAt;
  return value ? `${p('lastReportedAt')} ${new Date(value).toLocaleString()}` : p('connectionNotReported');
}

function lastConnectedLabel(row: PrintingPrinter) {
  const value = printerLastConnectedAt(row);
  return value
    ? `${p('lastConnectedAt')} ${new Date(value).toLocaleString()}`
    : `${p('lastConnectedAt')} ${p('connectionNotReported')}`;
}

function notifyPrintingStateChanged() {
  window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
}

async function createTestJob(row: PrintingPrinter) {
  if (!canCreateTestJob(row) || !window.confirm(p('createTestJobConfirm'))) return;
  try {
    actionId.value = row.id;
    const requestKey = getOrCreateTestJobRequestKey(row.id);
    const job = await createPrintingTestJob(row.id, requestKey);
    clearTestJobRequestKey(row.id);
    showSuccess(`${p('testJobCreated')} · #${job.id}`);
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

function getOrCreateTestJobRequestKey(printerId: string) {
  const keys = readTestJobRequestKeys();
  if (keys[printerId]) return keys[printerId];
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure request ID generation is unavailable');
  }
  const requestKey = `admin.${crypto.randomUUID()}`;
  keys[printerId] = requestKey;
  writeTestJobRequestKeys(keys);
  return requestKey;
}

function clearTestJobRequestKey(printerId: string) {
  const keys = readTestJobRequestKeys();
  delete keys[printerId];
  writeTestJobRequestKeys(keys);
}

function readTestJobRequestKeys(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(TEST_JOB_REQUEST_KEYS_STORAGE) || '{}',
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([printerId, requestKey]) =>
          /^\d+$/.test(printerId)
          && typeof requestKey === 'string'
          && /^admin\.[A-Za-z0-9-]{36}$/.test(requestKey),
      ),
    );
  } catch {
    return {};
  }
}

function writeTestJobRequestKeys(keys: Record<string, string>) {
  window.localStorage.setItem(
    TEST_JOB_REQUEST_KEYS_STORAGE,
    JSON.stringify(Object.fromEntries(Object.entries(keys).slice(-20))),
  );
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
        <h2>{{ p('printers') }}</h2>
        <p>{{ p('usbOnlyHint') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">
          {{ p('refresh') }}
        </button>
        <button class="printing-button" type="button" @click="openCreate">
          {{ p('addPrinter') }}
        </button>
      </div>
    </div>

    <p class="printing-hint">{{ p('testJobPrerequisite') }}</p>
    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('name') }}</th>
            <th>{{ p('channelType') }}</th>
            <th>{{ p('paperWidth') }}</th>
            <th>{{ p('purpose') }}</th>
            <th>{{ p('capabilityStatus') }}</th>
            <th>{{ p('configurationStatus') }}</th>
            <th>{{ p('connectionStatus') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><strong>{{ row.name }}</strong></td>
            <td>
              <code>{{ row.channelType }}</code>
              <small>{{ row.channelType === 'LOCAL_USB_ESCPOS' ? p('usbChannelName') : p('notImplementedChannel') }}</small>
            </td>
            <td>{{ row.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</td>
            <td>{{ row.purpose }}</td>
            <td>
              <span :class="['printing-badge', settings?.printingEnabled ? 'printing-badge--success' : 'printing-badge--warning']">
                {{ capabilityLabel() }}
              </span>
            </td>
            <td>
              <span :class="['printing-badge', printerConfigurationState(row) === 'CONFIGURED' ? 'printing-badge--success' : 'printing-badge--warning']">
                {{ configurationLabel(printerConfigurationState(row)) }}
              </span>
            </td>
            <td>
              <span :class="['printing-badge', connectionBadgeClass(printerConnectionState(row))]">
                {{ connectionLabel(printerConnectionState(row)) }}
              </span>
              <small>{{ evidenceLabel(row) }}</small>
              <small>{{ lastConnectedLabel(row) }}</small>
            </td>
            <td>
              <div class="printing-actions">
                <button
                  class="printing-button printing-button--secondary printing-button--small"
                  type="button"
                  :disabled="row.channelType !== 'LOCAL_USB_ESCPOS' || actionId === row.id"
                  @click="openEdit(row)"
                >
                  {{ p('edit') }}
                </button>
                <button
                  class="printing-button printing-button--secondary printing-button--small"
                  type="button"
                  :disabled="(!row.enabled && row.channelType !== 'LOCAL_USB_ESCPOS') || actionId === row.id"
                  @click="toggleEnabled(row)"
                >
                  {{ row.enabled ? p('disable') : p('enable') }}
                </button>
                <button
                  class="printing-button printing-button--small"
                  type="button"
                  :title="canCreateTestJob(row) ? p('createTestJob') : p('testJobPrerequisite')"
                  :disabled="!canCreateTestJob(row) || actionId === row.id"
                  @click="createTestJob(row)"
                >
                  {{ p('createTestJob') }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="8">{{ p('printerNotConfigured') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="8">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal" @submit.prevent="save">
      <header class="printing-modal__header"><h2>{{ form.id ? p('editPrinter') : p('addPrinter') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field printing-field--full">
          {{ p('name') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('channelType') }}
          <select disabled><option>{{ p('usbChannelName') }}</option></select>
        </label>
        <label class="printing-field">
          {{ p('paperWidth') }}
          <select v-model="form.paperWidth"><option value="MM58">58 mm</option><option value="MM80">80 mm</option></select>
        </label>
        <label class="printing-field">
          {{ p('purpose') }}
          <select v-model="form.purpose">
            <option v-for="purpose in purposes" :key="purpose" :value="purpose">{{ purpose }}</option>
          </select>
        </label>
        <p class="printing-hint">{{ p('usbConfiguredOnTerminal') }}</p>
        <p class="printing-hint printing-field--full">{{ p('usbOnlyHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
