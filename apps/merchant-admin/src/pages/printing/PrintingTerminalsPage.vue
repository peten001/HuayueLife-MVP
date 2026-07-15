<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createMerchantTerminal,
  getMerchantTerminals,
  revokeMerchantTerminal,
  updateMerchantTerminal,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  MerchantTerminal,
  MerchantTerminalPayload,
  MerchantTerminalPlatform,
} from '@/types/printing';

const { p } = usePrintingI18n();
const rows = ref<MerchantTerminal[]>([]);
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const message = ref('');
const success = ref(false);
const capabilitiesText = ref('{}');

const form = reactive({
  id: '',
  name: '',
  platform: 'ANDROID' as MerchantTerminalPlatform,
});

const platforms: MerchantTerminalPlatform[] = ['ANDROID', 'WEB', 'SERVER'];

function resetForm() {
  Object.assign(form, { id: '', name: '', platform: 'ANDROID' });
  capabilitiesText.value = '{}';
}

function openCreate() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: MerchantTerminal) {
  Object.assign(form, { id: row.id, name: row.name, platform: row.platform });
  capabilitiesText.value = JSON.stringify(row.capabilities ?? {}, null, 2);
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function payload(): MerchantTerminalPayload {
  const parsed: unknown = JSON.parse(capabilitiesText.value || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(p('invalidJson'));
  }
  return {
    name: form.name.trim(),
    platform: form.platform,
    capabilities: parsed as Record<string, unknown>,
  };
}

async function load() {
  try {
    loading.value = true;
    rows.value = await getMerchantTerminals();
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
      await updateMerchantTerminal(form.id, payload());
    } else {
      await createMerchantTerminal(payload());
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

async function revoke(row: MerchantTerminal) {
  if (!window.confirm(p('revokeTerminalConfirm'))) return;
  try {
    await revokeMerchantTerminal(row.id);
    await load();
    showSuccess(p('terminalRevoked'));
  } catch (error) {
    showError(error);
  }
}

function safeStatus(row: MerchantTerminal) {
  return row.revokedAt ? p('terminalRevoked') : p('unpairedOffline');
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
        <h2>{{ p('terminals') }}</h2>
        <p>{{ p('terminalHint') }}</p>
      </div>
      <div class="printing-toolbar__actions">
        <button class="printing-button printing-button--secondary" type="button" @click="load">{{ p('refresh') }}</button>
        <button class="printing-button" type="button" @click="openCreate">{{ p('addTerminal') }}</button>
      </div>
    </div>

    <p :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="printing-table-wrap">
      <table class="printing-table">
        <thead>
          <tr>
            <th>{{ p('terminalName') }}</th>
            <th>{{ p('platform') }}</th>
            <th>{{ p('status') }}</th>
            <th>{{ p('appVersion') }}</th>
            <th>{{ p('lastSeenAt') }}</th>
            <th>{{ p('revokedAt') }}</th>
            <th>{{ p('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><strong>{{ row.name }}</strong></td>
            <td>{{ row.platform }}</td>
            <td><span :class="['printing-badge', row.revokedAt ? 'printing-badge--danger' : 'printing-badge--warning']">{{ safeStatus(row) }}</span></td>
            <td>{{ row.appVersion || '—' }}</td>
            <td>{{ row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : p('never') }}</td>
            <td>{{ row.revokedAt ? new Date(row.revokedAt).toLocaleString() : '—' }}</td>
            <td>
              <div class="printing-actions">
                <button class="printing-button printing-button--secondary printing-button--small" type="button" :disabled="Boolean(row.revokedAt)" @click="openEdit(row)">{{ p('edit') }}</button>
                <button class="printing-button printing-button--danger printing-button--small" type="button" :disabled="Boolean(row.revokedAt)" @click="revoke(row)">{{ p('revoke') }}</button>
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
      <header class="printing-modal__header"><h2>{{ form.id ? p('editTerminal') : p('addTerminal') }}</h2></header>
      <div class="printing-modal__body">
        <label class="printing-field">
          {{ p('terminalName') }}
          <input v-model="form.name" required maxlength="80" />
        </label>
        <label class="printing-field">
          {{ p('platform') }}
          <select v-model="form.platform"><option v-for="platform in platforms" :key="platform" :value="platform">{{ platform }}</option></select>
        </label>
        <label class="printing-field printing-field--full">
          {{ p('capabilities') }}
          <textarea v-model="capabilitiesText" spellcheck="false"></textarea>
        </label>
        <p class="printing-hint printing-field--full">{{ p('terminalHint') }}</p>
      </div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="closeModal">{{ p('cancel') }}</button>
        <button class="printing-button" type="submit" :disabled="saving">{{ saving ? p('saving') : p('save') }}</button>
      </footer>
    </form>
  </div>
</template>
