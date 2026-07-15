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

const { p } = usePrintingI18n();
const rows = ref<PrintingPrinter[]>([]);
const settings = ref<MerchantPrintingSettings | null>(null);
const loading = ref(false);
const saving = ref(false);
const actionId = ref('');
const message = ref('');
const success = ref(false);
const modalOpen = ref(false);
const capabilitiesText = ref('{}');
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
  capabilitiesText.value = '{}';
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
  capabilitiesText.value = JSON.stringify(row.capabilities ?? {}, null, 2);
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function parseCapabilities(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(capabilitiesText.value || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(p('invalidJson'));
  }
  return parsed as Record<string, unknown>;
}

function buildPayload(): PrintingPrinterPayload {
  return {
    name: form.name.trim(),
    channelType: 'LOCAL_USB_ESCPOS',
    paperWidth: form.paperWidth,
    purpose: form.purpose,
    // Safety invariant: new printer inventory is never armed by creation.
    enabled: false,
    // USB identity/interface/endpoint are discovered and stored by the Android connector.
    connectionConfig: {},
    capabilities: parseCapabilities(),
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
    const payload = buildPayload();
    if (form.id) {
      // Enabling is deliberately a separate, confirmed action in the inventory table.
      const { enabled: _enabled, ...safeUpdate } = payload;
      await updatePrintingPrinter(form.id, safeUpdate);
    } else {
      await createPrintingPrinter(payload);
    }
    closeModal();
    await load();
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
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

function canCreateTestJob(row: PrintingPrinter) {
  return Boolean(
    row.channelType === 'LOCAL_USB_ESCPOS' &&
      row.enabled &&
      settings.value?.printingEnabled &&
      settings.value.featureFlags.taskCenterEnabled &&
      settings.value.featureFlags.executionEnabled,
  );
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
  message.value = error instanceof SyntaxError ? p('invalidJson') : errorMessage(error);
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
            <th>{{ p('config') }}</th>
            <th>{{ p('status') }}</th>
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
            <td>{{ row.channelType === 'LOCAL_USB_ESCPOS' ? p('usbConfiguredOnTerminal') : p('notImplementedChannel') }}</td>
            <td>
              <span :class="['printing-badge', row.enabled ? 'printing-badge--success' : 'printing-badge--warning']">
                {{ row.enabled ? p('enabled') : p('disabled') }}
              </span>
              <small>{{ row.status }}</small>
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
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="7">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="7">{{ p('loading') }}</td></tr>
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
        <label class="printing-field printing-field--full">
          {{ p('capabilities') }}
          <textarea v-model="capabilitiesText" spellcheck="false"></textarea>
        </label>
        <p class="printing-hint printing-field--full">{{ p('usbOnlyHint') }}</p>
        <p class="printing-hint printing-field--full">{{ p('ruleDefaultOffHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
