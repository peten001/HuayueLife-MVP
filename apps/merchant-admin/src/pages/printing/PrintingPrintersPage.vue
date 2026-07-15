<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPrintingPrinter,
  disablePrintingPrinter,
  getPrintingPrinters,
  updatePrintingPrinter,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrinterChannelType,
  PrinterPurpose,
  PrintingPaperWidth,
  PrintingPrinter,
  PrintingPrinterPayload,
} from '@/types/printing';

const { p } = usePrintingI18n();
const rows = ref<PrintingPrinter[]>([]);
const loading = ref(false);
const saving = ref(false);
const message = ref('');
const success = ref(false);
const modalOpen = ref(false);
const capabilitiesText = ref('{}');

const form = reactive({
  id: '',
  name: '',
  channelType: 'LOCAL_LAN_ESCPOS' as PrinterChannelType,
  paperWidth: 'MM80' as PrintingPaperWidth,
  purpose: 'FRONT_DESK' as PrinterPurpose,
  enabled: false,
  host: '',
  port: 9100,
});

const isLan = computed(() => form.channelType === 'LOCAL_LAN_ESCPOS');

const channels: PrinterChannelType[] = [
  'LOCAL_LAN_ESCPOS',
  'LOCAL_USB_ESCPOS',
  'CLOUD_FEIE',
  'CLOUD_XINYE',
  'CLOUD_GPRINTER',
  'BUILTIN_SUNMI',
  'BUILTIN_IMIN',
];

const purposes: PrinterPurpose[] = ['FRONT_DESK', 'KITCHEN', 'BAR', 'LABEL'];

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: false,
    host: '',
    port: 9100,
  });
  capabilitiesText.value = '{}';
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: PrintingPrinter) {
  const config = row.connectionConfig ?? {};
  Object.assign(form, {
    id: row.id,
    name: row.name,
    channelType: row.channelType,
    paperWidth: row.paperWidth,
    purpose: row.purpose,
    enabled: row.enabled,
    host: typeof config.host === 'string' ? config.host : '',
    port: typeof config.port === 'number' ? config.port : 9100,
  });
  capabilitiesText.value = JSON.stringify(row.capabilities ?? {}, null, 2);
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function parseJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(p('invalidJson'));
  }
  return parsed as Record<string, unknown>;
}

function buildPayload(): PrintingPrinterPayload {
  const capabilities = parseJson(capabilitiesText.value);
  return {
    name: form.name.trim(),
    channelType: form.channelType,
    paperWidth: form.paperWidth,
    purpose: form.purpose,
    enabled: form.enabled,
    connectionConfig: isLan.value
      ? { host: form.host.trim(), port: Number(form.port) }
      : {},
    capabilities,
  };
}

async function load() {
  try {
    loading.value = true;
    rows.value = await getPrintingPrinters();
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
      await updatePrintingPrinter(form.id, payload);
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
  if (row.enabled && !window.confirm(p('disablePrinterConfirm'))) return;
  try {
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
  }
}

function connectionLabel(row: PrintingPrinter) {
  if (row.channelType !== 'LOCAL_LAN_ESCPOS') return p('notImplementedChannel');
  const host = typeof row.connectionConfig?.host === 'string' ? row.connectionConfig.host : '—';
  const port = typeof row.connectionConfig?.port === 'number' ? row.connectionConfig.port : '—';
  return `${host}:${port}`;
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
        <p>{{ p('executionPending') }}</p>
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
              <small v-if="row.channelType !== 'LOCAL_LAN_ESCPOS'">{{ p('notImplementedChannel') }}</small>
            </td>
            <td>{{ row.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</td>
            <td>{{ row.purpose }}</td>
            <td>{{ connectionLabel(row) }}</td>
            <td>
              <span :class="['printing-badge', row.enabled ? 'printing-badge--warning' : '']">
                {{ row.enabled ? p('executionPending') : p('disabled') }}
              </span>
            </td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openEdit(row)">
                  {{ p('edit') }}
                </button>
                <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="toggleEnabled(row)">
                  {{ row.enabled ? p('disable') : p('enable') }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td class="printing-empty" colspan="7">{{ p('noData') }}</td>
          </tr>
          <tr v-if="loading">
            <td class="printing-empty" colspan="7">{{ p('loading') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal" @submit.prevent="save">
      <header class="printing-modal__header">
        <h2>{{ form.id ? p('editPrinter') : p('addPrinter') }}</h2>
      </header>
      <div class="printing-modal__body">
        <label class="printing-field">
          {{ p('name') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('channelType') }}
          <select v-model="form.channelType">
            <option v-for="channel in channels" :key="channel" :value="channel">{{ channel }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('paperWidth') }}
          <select v-model="form.paperWidth">
            <option value="MM58">58 mm</option>
            <option value="MM80">80 mm</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('purpose') }}
          <select v-model="form.purpose">
            <option v-for="purpose in purposes" :key="purpose" :value="purpose">{{ purpose }}</option>
          </select>
        </label>
        <label v-if="isLan" class="printing-field">
          {{ p('lanHost') }}
          <input v-model="form.host" required inputmode="decimal" placeholder="192.168.1.100" />
        </label>
        <label v-if="isLan" class="printing-field">
          {{ p('lanPort') }}
          <input v-model.number="form.port" required type="number" min="1" max="65535" />
        </label>
        <p v-else class="printing-hint printing-field--full">{{ p('notImplementedChannel') }}</p>
        <label class="printing-field printing-field--full">
          {{ p('capabilities') }}
          <textarea v-model="capabilitiesText" spellcheck="false"></textarea>
        </label>
        <label class="printing-check printing-field--full">
          <input v-model="form.enabled" type="checkbox" />
          {{ p('enabled') }} · {{ p('executionPending') }}
        </label>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
