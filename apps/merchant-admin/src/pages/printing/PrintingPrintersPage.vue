<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { createPrintingPrinter, createPrintingTestJob, disablePrintingPrinter, getMerchantPrintingSettings, getPrintingPrinters, getPrintingRules, updatePrintingPrinter } from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type { PrintingPaperWidth, PrintingPrinter, PrintingPrinterPayload, PrintingRule } from '@/types/printing';
import { printerConnectionState, PRINTING_STATE_CHANGED_EVENT, type PrinterConnectionState } from '@/utils/printing-status';

const { p } = usePrintingI18n();
const rows = ref<PrintingPrinter[]>([]);
const rules = ref<PrintingRule[]>([]);
const settings = ref<Awaited<ReturnType<typeof getMerchantPrintingSettings>> | null>(null);
const loading = ref(false);
const saving = ref(false);
const actionId = ref('');
const message = ref('');
const success = ref(false);
const modalOpen = ref(false);
const step = ref(1);
const pendingDisable = ref<PrintingPrinter | null>(null);
const TEST_JOB_REQUEST_KEYS_STORAGE = 'yunqiao.printing.testJobRequestKeys.v1';

const form = reactive({
  id: '', name: '', channelType: 'LOCAL_USB_ESCPOS' as PrintingPrinter['channelType'],
  provider: 'CLOUD_FEIE' as 'CLOUD_FEIE' | 'CLOUD_YILIAN', host: '', deviceId: '', secret: '', port: 9100,
  paperWidth: 'MM80' as PrintingPaperWidth,
});

const isCloud = computed(() => form.channelType === 'CLOUD_FEIE' || form.channelType === 'CLOUD_YILIAN');
const stepLabels = computed(() => [p('chooseMethod'), p('deviceInformation'), p('testAndSave')]);
function resetForm() {
  Object.assign(form, { id: '', name: '', channelType: 'LOCAL_USB_ESCPOS', provider: 'CLOUD_FEIE', host: '', deviceId: '', secret: '', port: 9100, paperWidth: 'MM80' });
  step.value = 1;
}
function openCreate() { resetForm(); modalOpen.value = true; }
function openEdit(row: PrintingPrinter) {
  const config = row.connectionConfig || {};
  Object.assign(form, { id: row.id, name: row.name, channelType: row.channelType, provider: row.channelType === 'CLOUD_YILIAN' ? 'CLOUD_YILIAN' : 'CLOUD_FEIE', host: typeof config.host === 'string' ? config.host : '', deviceId: typeof config.printerSn === 'string' ? config.printerSn : typeof config.machineCode === 'string' ? config.machineCode : '', secret: '', port: typeof config.port === 'number' ? config.port : 9100, paperWidth: row.paperWidth });
  step.value = 2; modalOpen.value = true;
}
function closeModal() { modalOpen.value = false; resetForm(); }
function selectMethod(channel: PrintingPrinter['channelType']) { form.channelType = channel; form.provider = channel === 'CLOUD_YILIAN' ? 'CLOUD_YILIAN' : 'CLOUD_FEIE'; step.value = 2; }
function methodTitle(channel: PrintingPrinter['channelType']) { return channel === 'LOCAL_USB_ESCPOS' ? p('usbPrinting') : channel === 'LOCAL_LAN_ESCPOS' ? p('lanPrinting') : p('cloudPrinting'); }
function methodHint(channel: PrintingPrinter['channelType']) { return channel === 'LOCAL_USB_ESCPOS' ? p('usbPrintingHint') : channel === 'LOCAL_LAN_ESCPOS' ? p('lanPrintingHint') : p('cloudPrintingHint'); }
function channelLabel(channel: PrintingPrinter['channelType']) { return channel === 'LOCAL_USB_ESCPOS' ? p('usbPrinting') : channel === 'LOCAL_LAN_ESCPOS' ? p('lanPrinting') : channel === 'CLOUD_FEIE' ? p('feieCloudPrinting') : p('yilianCloudPrinting'); }
function printerUsageLabel(printer: PrintingPrinter) {
  const active = rules.value.filter((rule) => rule.printerId === printer.id && rule.enabled && rule.autoPrint);
  if (!active.length) return p('unassignedPrintingScenes');
  const labels = active.map((rule) => rule.receiptType === 'TABLE_BILL' ? p('checkoutScenario') : rule.orderType === 'DINE_IN' ? p('dineInScenario') : rule.orderType === 'PICKUP' ? p('pickupScenario') : rule.orderType === 'DELIVERY' ? p('deliveryScenario') : p('customerReceipt'));
  return labels.length > 3 ? `${p('usedForPrintingScenesPrefix')}${labels.slice(0, 2).join('、')}${p('usedForPrintingScenesAndMore').replace('{count}', String(labels.length - 2))}` : `${p('usedForPrintingScenesPrefix')}${labels.join('、')}`;
}
function statusLabel(state: PrinterConnectionState) { return ({ CONNECTED: p('online'), OFFLINE: p('offline'), RECONNECTING: p('connecting'), WAITING_PERMISSION: p('notConnected'), DEVICE_NOT_DETECTED: p('notConnected'), UNKNOWN: p('statusUnknown') } as Record<PrinterConnectionState, string>)[state]; }
function statusClass(state: PrinterConnectionState) { return state === 'CONNECTED' ? 'printing-badge--success' : state === 'OFFLINE' || state === 'DEVICE_NOT_DETECTED' ? 'printing-badge--danger' : 'printing-badge--warning'; }

function connectionConfig() {
  if (form.channelType === 'LOCAL_USB_ESCPOS') return {};
  if (form.channelType === 'LOCAL_LAN_ESCPOS') return { host: form.host.trim(), port: Number(form.port) || 9100 };
  return form.channelType === 'CLOUD_FEIE' ? { printerSn: form.deviceId.trim() } : { machineCode: form.deviceId.trim() };
}
function payload(): PrintingPrinterPayload {
  return { name: form.name.trim(), channelType: form.channelType, paperWidth: form.paperWidth, enabled: true, connectionConfig: connectionConfig() };
}
// Keep the public edit surface narrow; capabilityStatus, configurationStatus,
// and connectionStatus remain API/readiness concepts, not merchant-facing columns.
function buildUpdatePayload(): Partial<PrintingPrinterPayload> {
  return { name: form.name.trim(), paperWidth: form.paperWidth };
}
function updatePayload(): Partial<PrintingPrinterPayload> { return { ...buildUpdatePayload(), connectionConfig: connectionConfig() }; }
function canNext() {
  if (step.value === 1) return Boolean(form.channelType);
  if (step.value === 2) return Boolean(form.name.trim()) && (form.channelType === 'LOCAL_USB_ESCPOS' || (form.channelType === 'LOCAL_LAN_ESCPOS' ? form.host.trim() : form.deviceId.trim()));
  return true;
}
function nextStep() { if (canNext()) step.value = Math.min(3, step.value + 1); }
function previousStep() { step.value = Math.max(1, step.value - 1); }

async function load() { try { loading.value = true; [rows.value, settings.value, rules.value] = await Promise.all([getPrintingPrinters(), getMerchantPrintingSettings(), getPrintingRules()]); } catch (error) { showError(error); } finally { loading.value = false; } }
async function save() {
  if (saving.value || !canNext()) return;
  try { saving.value = true; if (form.id) await updatePrintingPrinter(form.id, updatePayload()); else await createPrintingPrinter(payload()); closeModal(); await load(); window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT)); showSuccess(`${p('printerSaved')} · ${p('printerSavedHint')}`); } catch (error) { showError(error); } finally { saving.value = false; }
}
function getOrCreateTestJobRequestKey(printerId: string) { const keys = readKeys(); if (keys[printerId]) return keys[printerId]; const key = `admin.${crypto.randomUUID()}`; keys[printerId] = key; localStorage.setItem(TEST_JOB_REQUEST_KEYS_STORAGE, JSON.stringify(keys)); return key; }
function readKeys(): Record<string, string> { try { const value = JSON.parse(localStorage.getItem(TEST_JOB_REQUEST_KEYS_STORAGE) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
async function testPrint(row: PrintingPrinter) { if (row.channelType !== 'LOCAL_USB_ESCPOS' || !settings.value?.featureFlags.executionEnabled) return; try { actionId.value = row.id; const job = await createPrintingTestJob(row.id, getOrCreateTestJobRequestKey(row.id)); showSuccess(`${p('testPrintCreated')} · #${job.id}`); } catch (error) { showError(error); } finally { actionId.value = ''; } }
function requestToggle(row: PrintingPrinter) {
  if (row.enabled) {
    pendingDisable.value = row;
    return;
  }
  void setEnabled(row, true);
}

async function confirmDisable() {
  const row = pendingDisable.value;
  pendingDisable.value = null;
  if (row) await setEnabled(row, false);
}

async function setEnabled(row: PrintingPrinter, enabled: boolean) {
  try {
    actionId.value = row.id;
    if (enabled) await updatePrintingPrinter(row.id, { enabled: true });
    else await disablePrintingPrinter(row.id);
    await load();
    window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
    showSuccess(enabled ? p('printerEnabled') : p('printerDisabled'));
  } catch (error) { showError(error); } finally { actionId.value = ''; }
}
function showError(error: unknown) { success.value = false; message.value = errorMessage(error); }
function showSuccess(value: string) { success.value = true; message.value = value; }
onMounted(load);
</script>

<template>
  <section class="printing-panel printing-printers-page">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy"><h2>{{ p('printers') }}</h2><p>{{ p('printerListDescription') }}</p></div>
      <div class="printing-toolbar__actions"><button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button><button class="printing-button" type="button" @click="openCreate">{{ p('addPrinter') }}</button></div>
    </div>
    <p v-if="message" :class="['printing-message', { 'printing-message--success': success }]" role="status">{{ message }}</p>
    <div v-if="loading" class="printing-empty-state"><strong>{{ p('loading') }}</strong></div>
    <div v-else-if="!rows.length" class="printing-empty-state"><div class="printing-empty-state__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h14v12H5zM8 7V5h8v2m-8 5h8m-8 3h5" /></svg></div><strong>{{ p('noPrinters') }}</strong><p>{{ p('noPrintersHint') }}</p><button class="printing-button" type="button" @click="openCreate">{{ p('addPrinter') }}</button></div>
    <div v-else class="printing-printer-list">
      <article v-for="row in rows" :key="row.id" class="printing-printer-row">
        <div class="printing-printer-row__identity"><div class="printing-printer-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 9h12v9H6zM8 9V5h8v4m-5 4h4m-5 3h6" /></svg></div><div><strong>{{ row.name }}</strong><span>{{ channelLabel(row.channelType) }} · {{ printerUsageLabel(row) }}</span></div></div>
        <span :class="['printing-badge', statusClass(printerConnectionState(row))]">{{ statusLabel(printerConnectionState(row)) }}</span>
        <div class="printing-actions"><button class="printing-button printing-button--secondary printing-button--small" type="button" @click="openEdit(row)">{{ p('settings') }}</button><button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="testPrint(row)">{{ p('testPrint') }}</button><button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="actionId === row.id" @click="requestToggle(row)">{{ row.enabled ? p('disable') : p('enable') }}</button></div>
      </article>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal printing-modal--printer-flow" @submit.prevent="step === 3 ? save() : nextStep()">
      <header class="printing-modal__header"><div><span class="printing-modal__eyebrow">{{ p('addPrinter') }}</span><h2>{{ form.id ? p('editPrinter') : p('newPrinterTitle') }}</h2></div><button class="printing-modal__close" type="button" :aria-label="p('close')" @click="closeModal">×</button></header>
      <div class="printing-flow-steps"><div v-for="(label, index) in stepLabels" :key="label" :class="['printing-flow-step', { 'is-active': step === index + 1, 'is-complete': step > index + 1 }]" @click="step > index + 1 && (step = index + 1)"><span>{{ index + 1 }}</span><b>{{ label }}</b></div></div>
      <div class="printing-modal__body">
        <template v-if="step === 1">
          <div class="printing-step-copy"><span class="printing-step-kicker">{{ p('stepOne') }}</span><h3>{{ p('choosePrintingMethod') }}</h3><p>{{ p('choosePrintingMethodHint') }}</p></div>
          <div class="printing-method-grid printing-field--full"><button v-for="method in (['LOCAL_USB_ESCPOS', 'LOCAL_LAN_ESCPOS', 'CLOUD_FEIE'] as const)" :key="method" :class="['printing-method-card', { 'is-selected': form.channelType === method || (method === 'CLOUD_FEIE' && isCloud) }]" type="button" @click="selectMethod(method)"><span class="printing-method-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path v-if="method === 'LOCAL_USB_ESCPOS'" d="M12 4v12m0-8 3-3m-3 3L9 5m3 11v3m-3-3h6" /><path v-else-if="method === 'LOCAL_LAN_ESCPOS'" d="M5 5h14v14H5zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M9 9l6 6M15 9l-6 6" /><path v-else d="M7 17h10a3 3 0 0 0 .2-6A5.5 5.5 0 0 0 6.5 9.5 3.5 3.5 0 0 0 7 17Z" /></svg></span><strong>{{ methodTitle(method) }}</strong><small>{{ methodHint(method) }}</small><i v-if="form.channelType === method || (method === 'CLOUD_FEIE' && isCloud)">✓</i></button></div>
        </template>
        <template v-else-if="step === 2">
          <div class="printing-step-copy printing-field--full"><span class="printing-step-kicker">{{ p('stepTwo') }}</span><h3>{{ p('deviceInformation') }}</h3><p>{{ p('printerConnectionInfoHint') }}</p></div>
          <label class="printing-field printing-field--full">{{ p('printerName') }}<input v-model="form.name" required maxlength="80" :placeholder="p('printerNamePlaceholder')" /></label>
          <div v-if="form.channelType === 'LOCAL_USB_ESCPOS'" class="printing-inline-note printing-field--full"><strong>{{ p('connectedDevice') }}</strong><span>{{ p('usbAutoDetectHint') }}</span></div>
          <label v-if="form.channelType === 'LOCAL_LAN_ESCPOS'" class="printing-field printing-field--full">{{ p('lanIpAddress') }}<input v-model="form.host" required placeholder="192.168.1.100" inputmode="decimal" /></label>
          <template v-if="isCloud"><label class="printing-field">{{ p('cloudProvider') }}<select v-model="form.provider" @change="form.channelType = form.provider"><option value="CLOUD_FEIE">{{ p('feieCloudPrinting') }}</option><option value="CLOUD_YILIAN">{{ p('yilianCloudPrinting') }}</option></select></label><label class="printing-field">{{ form.provider === 'CLOUD_FEIE' ? p('printerNumber') : p('terminalNumber') }}<input v-model="form.deviceId" required /></label><div class="printing-inline-note printing-field--full"><strong>{{ p('cloudSecretLabel') }}</strong><span>{{ p('cloudSecretServerHint') }}</span></div></template>
          <label v-if="form.channelType === 'LOCAL_LAN_ESCPOS'" class="printing-field">{{ p('lanPort') }}<input v-model.number="form.port" type="number" min="1" max="65535" /></label>
          <label class="printing-field">{{ p('paperWidth') }}<select v-model="form.paperWidth"><option value="MM58">58 mm</option><option value="MM80">80 mm</option></select></label>
        </template>
        <template v-else>
          <div class="printing-step-copy printing-field--full"><span class="printing-step-kicker">{{ p('stepThree') }}</span><h3>{{ p('testAndSave') }}</h3><p>{{ p('testAndSaveHint') }}</p></div><div class="printing-review-card printing-field--full"><div><span>{{ p('printerName') }}</span><strong>{{ form.name || '—' }}</strong></div><div><span>{{ p('printingMethod') }}</span><strong>{{ isCloud ? (form.provider === 'CLOUD_FEIE' ? p('feieCloudPrinting') : p('yilianCloudPrinting')) : methodTitle(form.channelType) }}</strong></div><div><span>{{ p('paperWidth') }}</span><strong>{{ form.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</strong></div></div><div class="printing-test-actions printing-field--full"><button class="printing-button printing-button--secondary" type="button" disabled>{{ isCloud ? p('verifyDevice') : form.channelType === 'LOCAL_LAN_ESCPOS' ? p('testConnection') : p('testPrint') }}</button><span>{{ p('testBeforeSaveHint') }}</span></div></template>
      </div>
      <footer class="printing-modal__footer"><button class="printing-button printing-button--secondary" type="button" @click="step === 1 ? closeModal() : previousStep()">{{ step === 1 ? p('cancel') : p('previousStep') }}</button><button class="printing-button" type="submit" :disabled="saving || !canNext()">{{ saving ? p('saving') : step === 3 ? p('savePrinter') : p('nextStep') }}</button></footer>
    </form>
  </div>

  <div v-if="pendingDisable" class="printing-modal-backdrop" @click.self="pendingDisable = null">
    <section class="printing-modal printing-confirm-modal" role="dialog" aria-modal="true" :aria-labelledby="`disable-printer-${pendingDisable.id}`">
      <header class="printing-modal__header"><div><span class="printing-modal__eyebrow">{{ p('printer') }}</span><h2 :id="`disable-printer-${pendingDisable.id}`">{{ p('disable') }}{{ pendingDisable.name }}</h2></div><button class="printing-modal__close" type="button" :aria-label="p('close')" @click="pendingDisable = null">×</button></header>
      <div class="printing-modal__body"><p class="printing-hint printing-field--full">{{ p('disablePrinterConfirm') }}</p></div>
      <footer class="printing-modal__footer"><button class="printing-button printing-button--secondary" type="button" @click="pendingDisable = null">{{ p('cancel') }}</button><button class="printing-button printing-button--danger" type="button" @click="confirmDisable">{{ p('confirmAction') }}</button></footer>
    </section>
  </div>
</template>
