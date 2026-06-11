<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import {
  enableTable,
  createTable,
  disableTable,
  getProfile,
  getTableQrBlob,
  downloadTableQr,
  getTables,
  rotateTableQr,
  updateTable,
} from '@/api/merchant';
import type { DiningTable, MerchantProfile } from '@/types/api';

const rows = ref<DiningTable[]>([]);
const profile = ref<MerchantProfile | null>(null);
const { locale, t } = useI18n();
const form = reactive({ id: '', tableNo: '', tableName: '' });
const message = ref('');

async function load() {
  const [tables, merchantProfile] = await Promise.all([getTables(), getProfile()]);
  rows.value = tables;
  profile.value = merchantProfile;
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

async function enable(row: DiningTable) {
  if (!confirm(t('enableTableConfirm', { tableNo: row.tableNo }))) return;
  await enableTable(row.id);
  await load();
}

async function printQr(row: DiningTable) {
  try {
    const blob = await getTableQrBlob(row.id);
    const dataUrl = await blobToDataUrl(blob);
    const popup = window.open('', '_blank', 'width=900,height=1200');
    if (!popup) {
      message.value = t('operationFailed');
      return;
    }

    const merchantName = displayMerchantName();
    const tableName = row.tableName?.trim() || '';
    const lines = [
      row.tableNo ? `${t('qrPrintTableNo')}: ${row.tableNo}` : '',
      tableName ? `${t('qrPrintTableName')}: ${tableName}` : '',
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join('<br />');

    popup.document.open();
    popup.document.write(`<!doctype html>
<html lang="${localeHtml()}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t('qrPrintPreview'))}</title>
  <style>
    body { margin: 0; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; background: #fff; color: #111; }
    .sheet { box-sizing: border-box; width: 100%; min-height: 100vh; padding: 40px 32px; display: grid; place-items: center; }
    .card { width: 100%; max-width: 560px; border: 1px solid #ddd; border-radius: 18px; padding: 28px; text-align: center; }
    .merchant { font-size: 28px; font-weight: 700; margin-bottom: 10px; }
    .meta { font-size: 20px; line-height: 1.6; margin-bottom: 18px; }
    .qr { width: 360px; max-width: 100%; height: 360px; object-fit: contain; display: block; margin: 0 auto 18px; }
    .line { font-size: 22px; line-height: 1.5; margin-top: 8px; }
    .hint { font-size: 24px; font-weight: 700; margin-top: 14px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { padding: 0; }
      .card { border: none; border-radius: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="card">
      <div class="merchant">${escapeHtml(merchantName)}</div>
      <div class="meta">${lines}</div>
      <img class="qr" src="${dataUrl}" alt="QR" />
      <div class="hint">${escapeHtml('微信扫码点餐')}</div>
      <div class="line">${escapeHtml(t('qrPrintVietnamese'))}</div>
      <div class="line">${escapeHtml(t('qrPrintEnglish'))}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 300);
    });
    window.onafterprint = () => window.close();
  <\/script>
</body>
</html>`);
    popup.document.close();
    popup.focus();
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : t('operationFailed');
  }
}

function displayMerchantName() {
  if (!profile.value) return '';
  return locale.value === 'vi' && profile.value.nameVi
    ? profile.value.nameVi
    : profile.value.nameZh;
}

function localeHtml() {
  return locale.value === 'vi' ? 'vi' : locale.value === 'en' ? 'en' : 'zh-CN';
}

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
            <button class="small" @click="printQr(row)">{{ t('printQr') }}</button>
            <button class="small warning" @click="rotate(row)">{{ t('rotateQr') }}</button>
            <button v-if="row.status === 'ACTIVE'" class="small danger" @click="disable(row)">{{ t('disable') }}</button>
            <button v-else class="small success" @click="enable(row)">{{ t('enabled') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.success {
  color: #17693c;
  background: #e5f5ec;
}
</style>
