<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import {
  createTable,
  disableTable,
  downloadTableQr,
  getTables,
  rotateTableQr,
  updateTable,
} from '@/api/merchant';
import type { DiningTable } from '@/types/api';

const rows = ref<DiningTable[]>([]);
const { t } = useI18n();
const form = reactive({ id: '', tableNo: '', tableName: '' });
const message = ref('');

async function load() {
  rows.value = await getTables();
}

function edit(row: DiningTable) {
  Object.assign(form, row);
}

function reset() {
  Object.assign(form, { id: '', tableNo: '', tableName: '' });
}

async function save() {
  try {
    const payload = { tableNo: form.tableNo, tableName: form.tableName || undefined };
    if (form.id) await updateTable(form.id, payload);
    else await createTable(payload);
    reset();
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function rotate(row: DiningTable) {
  if (!confirm(t('rotateQrConfirm', { tableNo: row.tableNo }))) return;
  await rotateTableQr(row.id);
  await load();
}

async function disable(row: DiningTable) {
  if (!confirm(t('disableTableConfirm', { tableNo: row.tableNo }))) return;
  await disableTable(row.id);
  await load();
}

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader :title="t('tables')" :description="t('tablesDescription')" />
  <form class="card inline-form" @submit.prevent="save">
    <input v-model="form.tableNo" :placeholder="t('tableNoPlaceholder')" required />
    <input v-model="form.tableName" :placeholder="t('tableNamePlaceholder')" />
    <button>{{ form.id ? t('saveChanges') : t('addTable') }}</button>
    <button v-if="form.id" type="button" class="secondary" @click="reset">{{ t('cancel') }}</button>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table>
      <thead><tr><th>{{ t('tableNo') }}</th><th>{{ t('name') }}</th><th>{{ t('qrVersion') }}</th><th>{{ t('status') }}</th><th>{{ t('actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.tableNo }}</td>
          <td>{{ row.tableName || '-' }}</td>
          <td>v{{ row.qrVersion }}</td>
          <td><span :class="['badge', row.status === 'ACTIVE' ? 'success' : 'muted']">{{ row.status === 'ACTIVE' ? t('enabled') : t('disable') }}</span></td>
          <td class="actions">
            <button class="small secondary" @click="edit(row)">{{ t('edit') }}</button>
            <button class="small" @click="downloadTableQr(row)">{{ t('downloadQr') }}</button>
            <button class="small warning" @click="rotate(row)">{{ t('rotateQr') }}</button>
            <button v-if="row.status === 'ACTIVE'" class="small danger" @click="disable(row)">{{ t('disable') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
