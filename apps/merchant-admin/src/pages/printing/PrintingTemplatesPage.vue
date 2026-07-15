<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPrintingTemplate,
  duplicatePrintingTemplate,
  getPrintingTemplates,
  updatePrintingTemplate,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintingPaperWidth,
  PrintingReceiptTemplate,
  PrintingReceiptTemplatePayload,
  PrintingReceiptType,
  ReceiptLanguageMode,
} from '@/types/printing';

const { p } = usePrintingI18n();
const rows = ref<PrintingReceiptTemplate[]>([]);
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const message = ref('');
const success = ref(false);
const definitionText = ref('');

const form = reactive({
  id: '',
  name: '',
  receiptType: 'ORDER_CUSTOMER' as PrintingReceiptType,
  paperWidth: 'MM80' as PrintingPaperWidth,
  languageMode: 'MERCHANT_DEFAULT' as ReceiptLanguageMode,
  enabled: false,
});

const languageModes: ReceiptLanguageMode[] = ['MERCHANT_DEFAULT', 'ZH', 'VI', 'EN'];

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    languageMode: 'MERCHANT_DEFAULT',
    enabled: false,
  });
  definitionText.value = JSON.stringify({
    schemaVersion: 1,
    sections: [
      { type: 'MERCHANT_HEADER' },
      { type: 'ORDER_INFO' },
      { type: 'ITEMS' },
      { type: 'TOTALS' },
      { type: 'FOOTER' },
    ],
  }, null, 2);
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: PrintingReceiptTemplate) {
  Object.assign(form, {
    id: row.id,
    name: row.name,
    receiptType: row.receiptType,
    paperWidth: row.paperWidth,
    languageMode: row.languageMode,
    enabled: row.enabled,
  });
  definitionText.value = JSON.stringify(row.definition, null, 2);
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function parseDefinition(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(definitionText.value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(p('invalidJson'));
  }
  return parsed as Record<string, unknown>;
}

function payload(): PrintingReceiptTemplatePayload {
  return {
    name: form.name.trim(),
    receiptType: form.receiptType,
    paperWidth: form.paperWidth,
    languageMode: form.languageMode,
    definition: parseDefinition(),
    enabled: form.enabled,
  };
}

async function load() {
  try {
    loading.value = true;
    rows.value = await getPrintingTemplates();
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
      await updatePrintingTemplate(form.id, payload());
    } else {
      await createPrintingTemplate(payload());
    }
    closeModal();
    await load();
    showSuccess(p('templateSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function duplicate(row: PrintingReceiptTemplate) {
  try {
    await duplicatePrintingTemplate(row.id);
    await load();
    showSuccess(p('templateDuplicated'));
  } catch (error) {
    showError(error);
  }
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
        <h2>{{ p('templates') }}</h2>
        <p>{{ p('templateSnapshotHint') }}</p>
        <p>{{ p('rcFixedRendererHint') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
        <button class="printing-button" type="button" @click="openCreate">{{ p('addTemplate') }}</button>
      </div>
    </div>

    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('name') }}</th>
            <th>{{ p('receiptType') }}</th>
            <th>{{ p('paperWidth') }}</th>
            <th>{{ p('languageMode') }}</th>
            <th>{{ p('version') }}</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('updatedAt') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><strong>{{ row.name }}</strong><small v-if="!row.merchantId">{{ p('systemDefault') }}</small></td>
            <td>{{ row.receiptType }}</td>
            <td>{{ row.paperWidth === 'MM58' ? '58 mm' : '80 mm' }}</td>
            <td>{{ row.languageMode }}</td>
            <td>v{{ row.version }}</td>
            <td><span :class="['printing-badge', row.enabled ? 'printing-badge--success' : '']">{{ row.enabled ? p('enabled') : p('disabled') }}</span></td>
            <td>{{ new Date(row.updatedAt).toLocaleString() }}</td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="!row.merchantId" @click="openEdit(row)">{{ p('edit') }}</button>
                <button class="printing-button printing-button--secondary printing-button--small" type="button" @click="duplicate(row)">{{ p('duplicate') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td class="printing-empty" colspan="8">{{ p('noData') }}</td></tr>
          <tr v-if="loading"><td class="printing-empty" colspan="8">{{ p('loading') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="modalOpen" class="printing-modal-backdrop" @click.self="closeModal">
    <form class="printing-modal" @submit.prevent="save">
      <header class="printing-modal__header"><h2>{{ form.id ? p('editTemplate') : p('addTemplate') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field printing-field--full">
          {{ p('name') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('receiptType') }}
          <select v-model="form.receiptType">
            <option value="ORDER_CUSTOMER">ORDER_CUSTOMER</option>
            <option value="TABLE_BILL">TABLE_BILL</option>
          </select>
        </label>
        <label class="printing-field">
          {{ p('paperWidth') }}
          <select v-model="form.paperWidth"><option value="MM58">58 mm</option><option value="MM80">80 mm</option></select>
        </label>
        <label class="printing-field">
          {{ p('languageMode') }}
          <select v-model="form.languageMode"><option v-for="mode in languageModes" :key="mode" :value="mode">{{ mode }}</option></select>
        </label>
        <label class="printing-check">
          <input v-model="form.enabled" type="checkbox" />
          {{ p('enabled') }}
        </label>
        <label class="printing-field printing-field--full">
          {{ p('definition') }}
          <textarea v-model="definitionText" required spellcheck="false"></textarea>
        </label>
        <p class="printing-hint printing-field--full">{{ p('templateSnapshotHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
