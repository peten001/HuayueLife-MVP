<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPrintingRule,
  getPrintingPrinters,
  getPrintingRules,
  getPrintingTemplates,
  setPrintingRuleEnabled,
  updatePrintingRule,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintingOrderType,
  PrintingPrinter,
  PrintingReceiptType,
  PrintingReceiptTemplate,
  PrintingRule,
  PrintingRulePayload,
  PrintingTriggerEvent,
} from '@/types/printing';
import { PRINTING_STATE_CHANGED_EVENT } from '@/utils/printing-status';

const { p } = usePrintingI18n();
const rows = ref<PrintingRule[]>([]);
const printers = ref<PrintingPrinter[]>([]);
const templates = ref<PrintingReceiptTemplate[]>([]);
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const message = ref('');
const success = ref(false);

const form = reactive({
  id: '',
  name: '',
  orderType: '' as PrintingOrderType | '',
  triggerEvent: 'ORDER_ACCEPTED' as PrintingTriggerEvent,
  receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType,
  printerId: '',
  receiptTemplateId: '',
  copies: 1,
  autoPrint: false,
  priority: 100,
});

const printerNames = computed(() => new Map(printers.value.map((printer) => [printer.id, printer.name])));
const rulePrinters = computed(() =>
  printers.value.filter((printer) => printer.channelType === 'LOCAL_USB_ESCPOS'),
);
const matchingTemplates = computed(() => {
  const printer = printers.value.find((item) => item.id === form.printerId);
  return templates.value.filter(
    (template) =>
      template.enabled &&
      template.receiptType === form.receiptType &&
      (!printer || template.paperWidth === printer.paperWidth),
  );
});
// V1 automatic creation hooks exist only for these two durable order events.
// The MANUAL enum remains readable for historical rows but is not offered as
// an automatic rule configuration.
const triggerEvents: PrintingTriggerEvent[] = ['ORDER_ACCEPTED', 'ORDER_COMPLETED'];
const orderTypes: PrintingOrderType[] = ['DINE_IN', 'PICKUP', 'DELIVERY'];

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    orderType: '',
    triggerEvent: 'ORDER_ACCEPTED',
    receiptType: 'ORDER_CUSTOMER',
    printerId: rulePrinters.value[0]?.id ?? '',
    receiptTemplateId: '',
    copies: 1,
    autoPrint: false,
    priority: 100,
  });
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: PrintingRule) {
  Object.assign(form, {
    id: row.id,
    name: row.name,
    orderType: row.orderType ?? '',
    triggerEvent: row.triggerEvent,
    receiptType: row.receiptType,
    printerId: row.printerId,
    receiptTemplateId: row.receiptTemplateId ?? '',
    copies: row.copies,
    autoPrint: row.autoPrint,
    priority: row.priority,
  });
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function payload(): PrintingRulePayload {
  return {
    name: form.name.trim(),
    orderType: form.orderType || null,
    triggerEvent: form.triggerEvent,
    receiptType: form.receiptType,
    printerId: form.printerId,
    receiptTemplateId: form.receiptTemplateId || (form.id ? null : undefined),
    copies: Number(form.copies),
    autoPrint: form.autoPrint,
    ...(form.id ? {} : { enabled: false }),
    priority: Number(form.priority),
  };
}

async function load() {
  try {
    loading.value = true;
    [rows.value, printers.value, templates.value] = await Promise.all([
      getPrintingRules(),
      getPrintingPrinters(),
      getPrintingTemplates(),
    ]);
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (form.autoPrint && !window.confirm(p('enableAutoPrintConfirm'))) return;
  try {
    saving.value = true;
    if (form.id) {
      await updatePrintingRule(form.id, payload());
    } else {
      await createPrintingRule(payload());
    }
    closeModal();
    await load();
    notifyPrintingStateChanged();
    showSuccess(p('ruleSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function toggle(row: PrintingRule) {
  const printer = printers.value.find((item) => item.id === row.printerId);
  if (!row.enabled && printer?.channelType !== 'LOCAL_USB_ESCPOS') return;
  if (!row.enabled && !window.confirm(p('enableRuleConfirm'))) return;
  try {
    await setPrintingRuleEnabled(row.id, !row.enabled);
    await load();
    notifyPrintingStateChanged();
    showSuccess(row.enabled ? p('disabled') : p('ruleEnabledHint'));
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown) {
  success.value = false;
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  success.value = true;
  message.value = value;
}

function notifyPrintingStateChanged() {
  window.dispatchEvent(new Event(PRINTING_STATE_CHANGED_EVENT));
}

onMounted(load);
</script>

<template>
  <section class="printing-panel">
    <div class="printing-toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('rules') }}</h2>
        <p>{{ p('ruleDefaultOffHint') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
        <button class="printing-button" type="button" :disabled="!rulePrinters.length" @click="openCreate">{{ p('addRule') }}</button>
      </div>
    </div>

    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('name') }}</th>
            <th>{{ p('triggerEvent') }}</th>
            <th>{{ p('orderType') }}</th>
            <th>{{ p('receiptType') }}</th>
            <th>{{ p('targetPrinter') }}</th>
            <th>{{ p('targetTemplate') }}</th>
            <th>{{ p('copies') }}</th>
            <th>{{ p('autoPrint') }}</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><strong>{{ row.name }}</strong><small>#{{ row.priority }}</small></td>
            <td><code>{{ row.triggerEvent }}</code></td>
            <td>{{ row.orderType || p('allOrderTypes') }}</td>
            <td>{{ row.receiptType }}</td>
            <td>{{ row.printer?.name || printerNames.get(row.printerId) || row.printerId }}</td>
            <td>{{ row.receiptTemplate?.name || row.receiptTemplateId || '—' }}</td>
            <td>{{ row.copies }}</td>
            <td><span :class="['printing-badge', row.autoPrint ? 'printing-badge--success' : 'printing-badge--warning']">{{ row.autoPrint ? p('enabled') : p('disabled') }}</span></td>
            <td><span :class="['printing-badge', row.enabled ? 'printing-badge--success' : 'printing-badge--warning']">{{ row.enabled ? p('enabled') : p('disabled') }}</span></td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="printers.find((printer) => printer.id === row.printerId)?.channelType !== 'LOCAL_USB_ESCPOS'" @click="openEdit(row)">{{ p('edit') }}</button>
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="!row.enabled && printers.find((printer) => printer.id === row.printerId)?.channelType !== 'LOCAL_USB_ESCPOS'" @click="toggle(row)">{{ row.enabled ? p('disable') : p('enable') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="10">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="10">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal" @submit.prevent="save">
      <header class="printing-modal__header"><h2>{{ form.id ? p('editRule') : p('addRule') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field">
          {{ p('name') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('targetPrinter') }}
          <select v-model="form.printerId" required>
            <option v-for="printer in rulePrinters" :key="printer.id" :value="printer.id">{{ printer.name }} · {{ printer.enabled ? p('enabled') : p('disabled') }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('triggerEvent') }}
          <select v-model="form.triggerEvent">
            <option v-for="event in triggerEvents" :key="event" :value="event">{{ event }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('targetTemplate') }}
          <select v-model="form.receiptTemplateId">
            <option value="">—</option>
            <option v-for="template in matchingTemplates" :key="template.id" :value="template.id">{{ template.name }} · v{{ template.version }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('receiptType') }}
          <select v-model="form.receiptType">
            <option value="ORDER_CUSTOMER">ORDER_CUSTOMER</option>
            <option value="TABLE_BILL">TABLE_BILL</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('orderType') }}
          <select v-model="form.orderType">
            <option value="">{{ p('allOrderTypes') }}</option>
            <option v-for="type in orderTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('copies') }}
          <input v-model.number="form.copies" required type="number" min="1" max="3" />
        </label>
        <label class="printing-field">
          {{ p('priority') }}
          <input v-model.number="form.priority" required type="number" min="0" max="1000" />
        </label>
        <label class="printing-check">
          <input v-model="form.autoPrint" type="checkbox" />
          {{ p('autoPrint') }}
        </label>
        <p class="printing-hint printing-field--full">{{ p('ruleDefaultOffHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
