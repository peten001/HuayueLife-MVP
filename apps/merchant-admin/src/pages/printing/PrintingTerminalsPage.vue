<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createMerchantTerminal,
  generateMerchantTerminalPairingCode,
  getMerchantTerminal,
  getMerchantTerminals,
  getPrintingPrinters,
  resetMerchantTerminalUsbConfig,
  revokeMerchantTerminal,
  rotateMerchantTerminalCredentials,
  setMerchantTerminalEnabled,
  updateMerchantTerminal,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  MerchantTerminal,
  PrintingPrinter,
  TerminalPairingCodeResult,
} from '@/types/printing';

const { p } = usePrintingI18n();
const rows = ref<MerchantTerminal[]>([]);
const printers = ref<PrintingPrinter[]>([]);
const selected = ref<MerchantTerminal | null>(null);
const pairing = ref<TerminalPairingCodeResult['pairing'] | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const actionId = ref('');
const modalOpen = ref(false);
const message = ref('');
const success = ref(false);
const copiedField = ref('');
const now = ref(Date.now());

const form = reactive({
  id: '',
  name: '',
  boundPrinterId: '',
});

const usbPrinters = computed(() =>
  printers.value.filter((printer) => printer.channelType === 'LOCAL_USB_ESCPOS'),
);
const pairingExpired = computed(() =>
  pairing.value ? Date.parse(pairing.value.expiresAt) <= now.value : false,
);
const pairingRemaining = computed(() => {
  if (!pairing.value) return '';
  const seconds = Math.max(0, Math.ceil((Date.parse(pairing.value.expiresAt) - now.value) / 1_000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
});

let clock: number | undefined;

function resetForm() {
  Object.assign(form, { id: '', name: '', boundPrinterId: '' });
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: MerchantTerminal) {
  Object.assign(form, {
    id: row.id,
    name: row.name,
    boundPrinterId: row.boundPrinterId ?? '',
  });
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function closePairing() {
  pairing.value = null;
  copiedField.value = '';
}

async function load() {
  try {
    loading.value = true;
    [rows.value, printers.value] = await Promise.all([
      getMerchantTerminals(),
      getPrintingPrinters(),
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
      await updateMerchantTerminal(form.id, {
        name: form.name.trim(),
        boundPrinterId: form.boundPrinterId || null,
      });
    } else {
      await createMerchantTerminal({
        name: form.name.trim(),
        platform: 'ANDROID',
        capabilities: {},
        boundPrinterId: form.boundPrinterId || null,
      });
    }
    closeModal();
    await load();
    showSuccess(p('terminalSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function openDetail(row: MerchantTerminal) {
  try {
    detailLoading.value = true;
    selected.value = await getMerchantTerminal(row.id);
  } catch (error) {
    showError(error);
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  selected.value = null;
}

async function generatePairing(row: MerchantTerminal) {
  if (
    row.pairingExpiresAt &&
    Date.parse(row.pairingExpiresAt) > Date.now() &&
    !window.confirm(p('regeneratePairingConfirm'))
  ) return;
  try {
    actionId.value = row.id;
    const result = await generateMerchantTerminalPairingCode(row.id, 10);
    pairing.value = result.pairing;
    now.value = Date.now();
    showSuccess(p('pairingGenerated'));
    await load();
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

async function rotateCredentials(row: MerchantTerminal) {
  if (!window.confirm(p('rotateCredentialsConfirm'))) return;
  try {
    actionId.value = row.id;
    const result = await rotateMerchantTerminalCredentials(row.id, 10);
    pairing.value = result.pairing;
    now.value = Date.now();
    showSuccess(p('pairingGenerated'));
    await load();
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

async function toggleEnabled(row: MerchantTerminal) {
  const enable = row.status === 'DISABLED';
  if (!window.confirm(p(enable ? 'enableTerminalConfirm' : 'disableTerminalConfirm'))) return;
  try {
    actionId.value = row.id;
    await setMerchantTerminalEnabled(row.id, enable);
    await load();
    showSuccess(p(enable ? 'terminalEnabled' : 'terminalDisabledMessage'));
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

async function resetUsb(row: MerchantTerminal) {
  if (!window.confirm(p('resetUsbConfirm'))) return;
  try {
    actionId.value = row.id;
    await resetMerchantTerminalUsbConfig(row.id);
    await load();
    showSuccess(p('resetUsbRequested'));
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

async function revoke(row: MerchantTerminal) {
  if (!window.confirm(p('revokeTerminalConfirm'))) return;
  try {
    actionId.value = row.id;
    await revokeMerchantTerminal(row.id);
    await load();
    showSuccess(p('terminalRevoked'));
  } catch (error) {
    showError(error);
  } finally {
    actionId.value = '';
  }
}

async function copyPairing(value: string, field: string) {
  try {
    await navigator.clipboard.writeText(value);
    copiedField.value = field;
  } catch (error) {
    showError(error);
  }
}

function terminalStatus(row: MerchantTerminal) {
  const labels = {
    UNPAIRED: p('terminalUnpaired'),
    ACTIVE: p('terminalActive'),
    DISABLED: p('terminalDisabled'),
    REVOKED: p('terminalRevokedStatus'),
  };
  return labels[row.status];
}

function statusClass(row: MerchantTerminal) {
  if (row.status === 'REVOKED') return 'printing-badge--danger';
  if (row.status === 'ACTIVE') return 'printing-badge--success';
  return 'printing-badge--warning';
}

function onlineLabel(row: MerchantTerminal) {
  if (row.onlineState === 'ONLINE') return p('online');
  if (row.onlineState === 'OFFLINE') return p('offline');
  return p('unknown');
}

function capabilities(row: MerchantTerminal) {
  const root = isRecord(row.capabilities) ? row.capabilities : {};
  const connector = isRecord(root.connector) ? root.connector : {};
  const diagnostics = isRecord(root.diagnostics) ? root.diagnostics : {};
  return { connector, diagnostics };
}

function diagnosticValue(row: MerchantTerminal, key: string) {
  const { connector, diagnostics } = capabilities(row);
  return diagnostics[key] ?? connector[key];
}

function deviceSummary(row: MerchantTerminal) {
  const manufacturer = diagnosticValue(row, 'manufacturer');
  const model = diagnosticValue(row, 'model');
  const values = [manufacturer, model].filter((value) => typeof value === 'string' && value);
  return values.length ? values.join(' ') : '—';
}

function usbConfiguredState(row: MerchantTerminal) {
  const value = diagnosticValue(row, 'usbConfigured');
  return typeof value === 'boolean' ? value : null;
}

function usbConfiguredLabel(row: MerchantTerminal) {
  const value = usbConfiguredState(row);
  if (value === true) return p('usbConfigured');
  if (value === false) return p('usbNotConfigured');
  return p('unknown');
}

function usbIdentifier(row: MerchantTerminal) {
  const vendorId = diagnosticValue(row, 'usbVendorId');
  const productId = diagnosticValue(row, 'usbProductId');
  if (!Number.isInteger(vendorId) || !Number.isInteger(productId)) return '—';
  return `${formatUsbId(vendorId as number)} / ${formatUsbId(productId as number)}`;
}

function usbInterface(row: MerchantTerminal) {
  const interfaceIndex = diagnosticValue(row, 'usbInterfaceIndex');
  const endpoint = diagnosticValue(row, 'usbEndpointAddress');
  if (!Number.isInteger(interfaceIndex) || !Number.isInteger(endpoint)) return '—';
  return `${interfaceIndex} / 0x${(endpoint as number).toString(16).padStart(2, '0')}`;
}

function usbPermission(row: MerchantTerminal) {
  const granted = diagnosticValue(row, 'usbPermissionGranted');
  if (granted === true) return p('permissionGranted');
  if (granted === false) return p('permissionNotGranted');
  return p('unknown');
}

function diagnosticCount(row: MerchantTerminal, key: string) {
  const value = diagnosticValue(row, key);
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function diagnosticTimestamp(row: MerchantTerminal, key: string) {
  const value = diagnosticValue(row, key);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === 'string' && value && Number.isFinite(Date.parse(value))) {
    return new Date(value).toLocaleString();
  }
  return '—';
}

function resetPending(row: MerchantTerminal) {
  if (!row.resetUsbRequestedAt) return false;
  return !row.resetUsbAcknowledgedAt ||
    Date.parse(row.resetUsbAcknowledgedAt) < Date.parse(row.resetUsbRequestedAt);
}

function resetStatus(row: MerchantTerminal) {
  if (!row.resetUsbRequestedAt) return p('resetNotRequested');
  return resetPending(row) ? p('resetPending') : p('resetAcknowledged');
}

function pairingValidity(row: MerchantTerminal) {
  if (row.status !== 'UNPAIRED' || !row.pairingExpiresAt) return '';
  return Date.parse(row.pairingExpiresAt) <= now.value ? p('pairingExpired') : p('pairingValid');
}

function formatUsbId(value: number) {
  return `0x${value.toString(16).padStart(4, '0')} (${value})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function showError(error: unknown) {
  success.value = false;
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  success.value = true;
  message.value = value;
}

onMounted(() => {
  void load();
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1_000);
});

onBeforeUnmount(() => {
  if (clock !== undefined) window.clearInterval(clock);
  closePairing();
});
</script>

<template>
  <section class="printing-panel">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('terminals') }}</h2>
        <p>{{ p('terminalHint') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
        <button class="printing-button" type="button" @click="openCreate">{{ p('addTerminal') }}</button>
      </div>
    </div>

    <p class="printing-hint">{{ p('createTerminalHint') }}</p>
    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table terminal-table">
        <thead>
          <tr>
            <th>{{ p('terminalName') }}</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('boundPrinter') }}</th>
            <th>{{ p('deviceSummary') }}</th>
            <th>{{ p('appVersion') }}</th>
            <th>{{ p('usbSummary') }}</th>
            <th>{{ p('lastSeenAt') }}</th>
            <th>{{ p('recentError') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><strong>{{ row.name }}</strong><small><code>#{{ row.id }}</code></small></td>
            <td>
              <span :class="['printing-badge', statusClass(row)]">{{ terminalStatus(row) }}</span>
              <small :class="row.onlineState === 'ONLINE' ? 'terminal-online' : ''">
                {{ onlineLabel(row) }}
              </small>
              <small v-if="pairingValidity(row)" :class="{ 'printing-text-danger': pairingValidity(row) === p('pairingExpired') }">
                {{ p('pairingCode') }}：{{ pairingValidity(row) }}
              </small>
            </td>
            <td>{{ row.boundPrinter?.name || p('noBoundPrinter') }}</td>
            <td>{{ deviceSummary(row) }}</td>
            <td>{{ row.appVersion || '—' }}</td>
            <td>
              {{ usbConfiguredLabel(row) }}
              <small>{{ usbIdentifier(row) }}</small>
            </td>
            <td>{{ row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : p('never') }}</td>
            <td>
              <span :class="{ 'printing-text-danger': row.lastErrorCode }">{{ row.lastErrorCode || p('noRecentError') }}</span>
              <small v-if="row.lastErrorMessage">{{ row.lastErrorMessage }}</small>
            </td>
            <td>
              <div class="printing-actions terminal-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="openDetail(row)">{{ p('view') }}</button>
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="row.status === 'REVOKED' || actionId === row.id" @click="openEdit(row)">{{ p('edit') }}</button>
                <button v-if="row.status === 'UNPAIRED'" class="printing-button printing-button--small" type="button" :title="row.boundPrinterId ? p('generatePairingCode') : p('bindPrinterFirst')" :disabled="!row.boundPrinterId || actionId === row.id" @click="generatePairing(row)">{{ p('generatePairingCode') }}</button>
                <button v-if="row.status === 'ACTIVE' || row.status === 'DISABLED'" class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="rotateCredentials(row)">{{ p('rotateCredentials') }}</button>
                <button v-if="row.status === 'ACTIVE' || row.status === 'DISABLED'" class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="toggleEnabled(row)">{{ row.status === 'ACTIVE' ? p('disable') : p('enable') }}</button>
                <button v-if="row.status === 'ACTIVE' || row.status === 'DISABLED'" class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="resetUsb(row)">{{ p('resetUsbConfig') }}</button>
                <button class="printing-button printing-button--danger printing-button--small" type="button" :disabled="row.status === 'REVOKED' || actionId === row.id" @click="revoke(row)">{{ p('revoke') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="9">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="9">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal" @submit.prevent="save">
      <header class="printing-modal__header"><h2>{{ form.id ? p('editTerminal') : p('addTerminal') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field printing-field--full">
          {{ p('terminalName') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field printing-field--full">
          {{ p('boundPrinter') }}
          <select v-model="form.boundPrinterId">
            <option value="">{{ p('noBoundPrinter') }}</option>
            <option v-for="printer in usbPrinters" :key="printer.id" :value="printer.id">
              {{ printer.name }} · {{ printer.paperWidth === 'MM58' ? '58 mm' : '80 mm' }} · {{ printer.enabled ? p('enabled') : p('disabled') }}
            </option>
          </select>
        </label>
        <p class="printing-hint printing-field--full">{{ p('terminalHint') }}</p>
        <p class="printing-hint printing-field--full">{{ p('createTerminalHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>

  <div v-if="pairing" class="printing-modal-backdrop" @click.self="closePairing">
    <section class="printing-modal pairing-modal">
      <header class="printing-modal__header"><h2>{{ p('pairingCode') }}</h2></header>
      <div class="printing-modal__body">
        <p class="printing-hint printing-field--full">{{ p('pairingShownOnce') }}</p>
        <div class="pairing-code printing-field--full" aria-live="polite">{{ pairing.pairingCode }}</div>
        <div class="pairing-copy printing-field--full">
          <code>{{ pairing.pairingPayload }}</code>
          <button class="printing-button printing-button--secondary" type="button" @click="copyPairing(pairing.pairingPayload, 'payload')">
            {{ copiedField === 'payload' ? p('copied') : p('copy') }}
          </button>
        </div>
        <dl class="printing-detail-grid printing-field--full">
          <dt>{{ p('pairingExpiresAt') }}</dt>
          <dd>{{ new Date(pairing.expiresAt).toLocaleString() }}</dd>
          <dt>{{ p('status') }}</dt>
          <dd :class="{ 'printing-text-danger': pairingExpired }">
            {{ pairingExpired ? p('pairingExpired') : `${p('pairingValid')} · ${pairingRemaining}` }}
          </dd>
        </dl>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="copyPairing(pairing.pairingCode, 'code')">
          {{ copiedField === 'code' ? p('copied') : `${p('copy')} ${p('pairingCode')}` }}
        </button>
        <button class="printing-button" type="button" @click="closePairing">{{ p('close') }}</button>
      </footer>
    </section>
  </div>

  <div v-if="selected || detailLoading" class="printing-modal-backdrop" @click.self="closeDetail">
    <section class="printing-modal printing-modal--wide">
      <header class="printing-modal__header"><h2>{{ p('terminalDetails') }}</h2></header>
      <div class="printing-modal__body">
        <p v-if="detailLoading" class="printing-hint printing-field--full">{{ p('loading') }}</p>
        <template v-if="selected">
          <dl class="printing-detail-grid printing-field--full">
            <dt>{{ p('terminalName') }}</dt><dd>{{ selected.name }}</dd>
            <dt>{{ p('status') }}</dt><dd>{{ terminalStatus(selected) }} · {{ onlineLabel(selected) }}</dd>
            <dt>{{ p('boundPrinter') }}</dt><dd>{{ selected.boundPrinter?.name || p('noBoundPrinter') }}</dd>
            <dt>{{ p('deviceSummary') }}</dt><dd>{{ deviceSummary(selected) }}</dd>
            <dt>{{ p('appVersion') }}</dt><dd>{{ selected.appVersion || '—' }}</dd>
            <dt>{{ p('buildRevision') }}</dt><dd>{{ diagnosticValue(selected, 'buildRevision') ?? '—' }}</dd>
            <dt>{{ p('androidApiLevel') }}</dt><dd>{{ diagnosticValue(selected, 'androidApiLevel') ?? '—' }}</dd>
            <dt>{{ p('networkState') }}</dt><dd>{{ diagnosticValue(selected, 'network') ?? '—' }}</dd>
            <dt>{{ p('usbSummary') }}</dt><dd>{{ usbConfiguredLabel(selected) }}</dd>
            <dt>{{ p('usbIdentifiers') }}</dt><dd>{{ usbIdentifier(selected) }}</dd>
            <dt>{{ p('usbInterfaceEndpoint') }}</dt><dd>{{ usbInterface(selected) }}</dd>
            <dt>{{ p('usbPermission') }}</dt><dd>{{ usbPermission(selected) }}</dd>
            <dt>{{ p('paperWidth') }}</dt><dd>{{ diagnosticValue(selected, 'paperWidth') ?? selected.boundPrinter?.paperWidth ?? '—' }}</dd>
            <dt>{{ p('localQueue') }}</dt><dd>{{ diagnosticCount(selected, 'queueDepth') ?? '—' }}</dd>
            <dt>{{ p('uncertainJobs') }}</dt><dd :class="{ 'printing-text-danger': (diagnosticCount(selected, 'uncertainJobCount') ?? 0) > 0 }">{{ diagnosticCount(selected, 'uncertainJobCount') ?? '—' }}</dd>
            <dt>{{ p('lastPrintAt') }}</dt><dd>{{ diagnosticTimestamp(selected, 'lastPrintAt') }}</dd>
            <dt>{{ p('configVersion') }}</dt><dd>{{ selected.configVersion ?? 0 }}</dd>
            <dt>{{ p('resetUsbConfig') }}</dt><dd>{{ resetStatus(selected) }}</dd>
            <dt>{{ p('lastSeenAt') }}</dt><dd>{{ selected.lastSeenAt ? new Date(selected.lastSeenAt).toLocaleString() : p('never') }}</dd>
            <dt>{{ p('recentError') }}</dt><dd :class="{ 'printing-text-danger': selected.lastErrorCode }">{{ selected.lastErrorCode || p('noRecentError') }} {{ selected.lastErrorMessage || '' }}</dd>
          </dl>
          <div v-if="selected.attempts?.length" class="printing-field printing-field--full">
            <strong>{{ p('attempts') }}</strong>
            <div class="attempt-list">
              <span v-for="attempt in selected.attempts" :key="attempt.id">
                #{{ attempt.jobId }} / {{ attempt.attemptNo }} · {{ attempt.result || 'PRINTING' }} · {{ attempt.errorCode || '—' }}
              </span>
            </div>
          </div>
        </template>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button" type="button" @click="closeDetail">{{ p('close') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.terminal-table {
  min-width: 1320px;
}

.terminal-actions {
  min-width: 280px;
}

.terminal-online {
  color: #17693c !important;
  font-weight: 700;
}

.pairing-modal {
  width: min(620px, 100%);
}

.pairing-code {
  padding: 16px;
  border: 1px solid #bcd9c4;
  border-radius: 12px;
  color: #145c2a;
  background: #eef8f0;
  font: 800 36px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.15em;
  text-align: center;
}

.pairing-copy {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pairing-copy code {
  flex: 1;
  min-width: 0;
  padding: 10px;
  overflow-wrap: anywhere;
  border-radius: 8px;
  background: #f4f7f5;
}

.attempt-list {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid #e1e8e3;
  border-radius: 10px;
  background: #f7faf8;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (max-width: 760px) {
  .pairing-copy {
    align-items: stretch;
    flex-direction: column;
  }

  .pairing-code {
    font-size: 28px;
  }
}
</style>
